from __future__ import annotations

from ..auth import (
    current_user,
    find_auth_user,
    is_primary_developer_username,
    load_user_store,
    normalize_display_name,
    normalize_username,
    require_owner_account_control,
    require_roles,
    save_user_store,
    serialize_user_record,
    sorted_user_records,
    validate_designer_label_uniqueness,
    validate_username,
)
from ..routes.common import (
    Any,
    Blueprint,
    USER_ROLES,
    check_password_hash,
    create_access_token,
    create_refresh_token,
    generate_password_hash,
    get_json_body,
    get_jwt_identity,
    jsonify,
    jwt_required,
)

def login() -> Any:
    data = get_json_body()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    user, record = find_auth_user(username)
    if not user or not record or not user.is_active:
        return jsonify({"error": "Invalid username or password."}), 401
    password_hash = str(record.get("password_hash") or "").strip()
    if not password_hash or not check_password_hash(password_hash, password):
        return jsonify({"error": "Invalid username or password."}), 401

    claims = {"role": user.role}
    access_token = create_access_token(identity=user.username, additional_claims=claims)
    refresh_token = create_refresh_token(identity=user.username, additional_claims=claims)

    return jsonify(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "Bearer",
            "expires_in": 1800,
            "user": user.to_dict(),
        }
    )

def refresh() -> Any:
    identity = get_jwt_identity()
    user, _record = find_auth_user(str(identity))
    if not user:
        return jsonify({"error": "User not found."}), 404

    new_access = create_access_token(identity=user.username, additional_claims={"role": user.role})
    return jsonify({"access_token": new_access})

def verify_token() -> Any:
    user = current_user()
    if not user:
        return jsonify({"valid": False, "error": "User not found."}), 404
    return jsonify({"valid": True, "user": user.to_dict()})

def logout() -> Any:
    return jsonify({"message": "Logged out. Remove tokens client-side."})

def get_users() -> Any:
    payload = load_user_store()
    records = [
        serialize_user_record(record)
        for record in sorted_user_records([item for item in payload.get("users", []) if isinstance(item, dict)])
    ]
    return jsonify(records)

def create_user() -> Any:
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid user payload."}), 400

    username = normalize_username(data.get("username"))
    password = str(data.get("password") or "")
    role = str(data.get("role") or "").strip().lower()
    email = str(data.get("email") or "").strip() or None
    display_name = str(data.get("display_name") or "").strip() or None
    raw_is_active = data.get("is_active", True)
    is_active = raw_is_active if isinstance(raw_is_active, bool) else str(raw_is_active).strip().lower() in {"1", "true", "yes", "on"}

    try:
        validate_username(username)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if role not in USER_ROLES:
        return jsonify({"error": "Role must be developer, admin, or designer."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long."}), 400

    payload = load_user_store()
    records = [item for item in payload.get("users", []) if isinstance(item, dict)]
    if any(normalize_username(item.get("username")) == username for item in records):
        return jsonify({"error": "A user with that username already exists."}), 409

    try:
        validate_designer_label_uniqueness(records, username=username, role=role, display_name=display_name)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    record = {
        "username": username,
        "display_name": normalize_display_name(display_name, username),
        "email": email,
        "role": role,
        "is_active": is_active,
        "password_hash": generate_password_hash(password),
    }
    records.append(record)
    payload["users"] = sorted_user_records(records)
    save_user_store(payload)
    return jsonify(serialize_user_record(record)), 201

def update_user(username: str) -> Any:
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid user payload."}), 400

    _actor, owner_control_error = require_owner_account_control(username)
    if owner_control_error:
        return owner_control_error

    payload = load_user_store()
    records = [item for item in payload.get("users", []) if isinstance(item, dict)]
    target_username = normalize_username(username)
    target_record = next(
        (item for item in records if normalize_username(item.get("username")) == target_username),
        None,
    )
    if not target_record:
        return jsonify({"error": "User not found."}), 404

    next_role = str(data.get("role", target_record.get("role") or "")).strip().lower()
    if next_role not in USER_ROLES:
        return jsonify({"error": "Role must be developer, admin, or designer."}), 400

    next_display_name = str(data.get("display_name", target_record.get("display_name") or "")).strip() or None
    next_email = str(data.get("email", target_record.get("email") or "")).strip() or None
    next_is_active = (
        bool(data.get("is_active"))
        if isinstance(data.get("is_active"), bool)
        else str(data.get("is_active", target_record.get("is_active", True))).strip().lower() in {"1", "true", "yes", "on"}
    )

    if is_primary_developer_username(target_username):
        next_role = "developer"
        next_is_active = True

    try:
        validate_designer_label_uniqueness(
            records,
            username=target_username,
            role=next_role,
            display_name=next_display_name,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    target_record["display_name"] = normalize_display_name(next_display_name, target_username)
    target_record["email"] = next_email
    target_record["role"] = next_role
    target_record["is_active"] = next_is_active

    supplied_password = str(data.get("password") or "")
    if supplied_password:
        if len(supplied_password) < 8:
            return jsonify({"error": "Password must be at least 8 characters long."}), 400
        target_record["password_hash"] = generate_password_hash(supplied_password)

    payload["users"] = sorted_user_records(records)
    save_user_store(payload)
    return jsonify(serialize_user_record(target_record))

def delete_user(username: str) -> Any:
    target_username = normalize_username(username)
    actor, owner_control_error = require_owner_account_control(target_username)
    if owner_control_error:
        return owner_control_error
    if is_primary_developer_username(target_username):
        return jsonify({"error": "The owner account cannot be deleted."}), 400

    if actor and normalize_username(actor.username) == target_username:
        return jsonify({"error": "You cannot delete the account you are currently using."}), 400

    payload = load_user_store()
    original_records = [item for item in payload.get("users", []) if isinstance(item, dict)]
    remaining_records = [
        item for item in original_records if normalize_username(item.get("username")) != target_username
    ]
    if len(remaining_records) == len(original_records):
        return jsonify({"error": "User not found."}), 404

    payload["users"] = sorted_user_records(remaining_records)
    save_user_store(payload)
    return jsonify({"message": "User deleted successfully."})
