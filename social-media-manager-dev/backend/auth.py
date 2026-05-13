from __future__ import annotations

from . import app as core

Any = core.Any
Callable = core.Callable
PRIMARY_DEVELOPER_DISPLAY_NAME = core.PRIMARY_DEVELOPER_DISPLAY_NAME
PRIMARY_DEVELOPER_EMAIL = core.PRIMARY_DEVELOPER_EMAIL
PRIMARY_DEVELOPER_PASSWORD = core.PRIMARY_DEVELOPER_PASSWORD
PRIMARY_DEVELOPER_USERNAME = core.PRIMARY_DEVELOPER_USERNAME
ROLE_TABS = core.ROLE_TABS
USER_ROLES = core.USER_ROLES
USERS_FILE = core.USERS_FILE
check_password_hash = core.check_password_hash
dataclass = core.dataclass
generate_password_hash = core.generate_password_hash
get_jwt_identity = core.get_jwt_identity
has_app_context = core.has_app_context
json = core.json
json_loads_safe = core.json_loads_safe
jsonify = core.jsonify
wraps = core.wraps


@dataclass
class AuthUser:
    username: str
    email: str | None
    display_name: str | None
    role: str
    is_active: bool = True

    @property
    def is_owner(self) -> bool:
        return is_primary_developer_username(self.username)

    def to_dict(self) -> dict[str, Any]:
        return {
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name or self.username,
            "role": self.role,
            "is_active": self.is_active,
            "is_owner": self.is_owner,
            "available_tabs": ROLE_TABS.get(self.role, []),
        }


def designer_label_for_user(user: AuthUser) -> str:
    return (user.display_name or user.username).strip() or user.username


def default_user_store_payload() -> dict[str, Any]:
    return {
        "users": [
            {
                "username": PRIMARY_DEVELOPER_USERNAME,
                "display_name": PRIMARY_DEVELOPER_DISPLAY_NAME,
                "email": PRIMARY_DEVELOPER_EMAIL,
                "role": "developer",
                "is_active": True,
                "password_hash": generate_password_hash(PRIMARY_DEVELOPER_PASSWORD),
            },
        ]
    }


def save_user_store(payload: dict[str, Any]) -> None:
    USERS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def normalize_username(value: str | None) -> str:
    return str(value or "").strip().lower()


def normalize_display_name(value: str | None, username: str) -> str:
    cleaned = str(value or "").strip()
    return cleaned or username


def is_primary_developer_username(username: str | None) -> bool:
    return normalize_username(username) == PRIMARY_DEVELOPER_USERNAME


def validate_username(username: str) -> None:
    if len(username) < 3 or len(username) > 64:
        raise ValueError("Username must be between 3 and 64 characters.")
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    if any(char not in allowed for char in username):
        raise ValueError("Username may only contain lowercase letters, numbers, dots, underscores, and hyphens.")


def build_auth_user(record: dict[str, Any]) -> AuthUser:
    record_username = str(record.get("username") or "").strip()
    role = str(record.get("role") or "").strip().lower()
    if not record_username:
        raise RuntimeError("User records must include a username.")
    if role not in USER_ROLES:
        raise RuntimeError(f"Unsupported role '{role}' in users file for {record_username}.")
    return AuthUser(
        username=record_username,
        email=str(record.get("email") or "").strip() or None,
        display_name=normalize_display_name(record.get("display_name"), record_username),
        role=role,
        is_active=bool(record.get("is_active", True)),
    )


def serialize_user_record(record: dict[str, Any]) -> dict[str, Any]:
    payload = build_auth_user(record).to_dict()
    payload["has_password"] = bool(str(record.get("password_hash") or "").strip())
    return payload


def ensure_primary_developer_user(payload: dict[str, Any]) -> bool:
    users = payload.setdefault("users", [])
    if not isinstance(users, list):
        raise RuntimeError("User store must contain a 'users' array.")

    for record in users:
        if not isinstance(record, dict):
            continue
        if not is_primary_developer_username(record.get("username")):
            continue

        changed = False
        if str(record.get("role") or "").strip().lower() != "developer":
            record["role"] = "developer"
            changed = True
        if not bool(record.get("is_active", True)):
            record["is_active"] = True
            changed = True
        if not str(record.get("display_name") or "").strip():
            record["display_name"] = PRIMARY_DEVELOPER_DISPLAY_NAME
            changed = True
        if not str(record.get("password_hash") or "").strip():
            record["password_hash"] = generate_password_hash(PRIMARY_DEVELOPER_PASSWORD)
            changed = True
        return changed

    users.insert(0, default_user_store_payload()["users"][0])
    return True


def ensure_temporary_admin_user(payload: dict[str, Any]) -> bool:
    users = payload.setdefault("users", [])
    if not isinstance(users, list):
        raise RuntimeError("User store must contain a 'users' array.")

    target_username = "admin"
    for record in users:
        if not isinstance(record, dict):
            continue
        if normalize_username(record.get("username")) != target_username:
            continue

        changed = False
        if str(record.get("role") or "").strip().lower() != "admin":
            record["role"] = "admin"
            changed = True
        if not bool(record.get("is_active", True)):
            record["is_active"] = True
            changed = True
        if not str(record.get("display_name") or "").strip():
            record["display_name"] = "Admin"
            changed = True
        if not str(record.get("password_hash") or "").strip():
            record["password_hash"] = generate_password_hash("admin123")
            changed = True
        return changed

    users.append(
        {
            "username": target_username,
            "display_name": "Admin",
            "email": None,
            "role": "admin",
            "is_active": True,
            "password_hash": generate_password_hash("admin123"),
        }
    )
    return True


def ensure_user_store_file() -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if USERS_FILE.exists():
        return
    save_user_store(default_user_store_payload())


def load_user_store() -> dict[str, Any]:
    ensure_user_store_file()
    try:
        payload = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"Unable to read user store: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("User store must be a JSON object.")
    users = payload.get("users")
    if not isinstance(users, list):
        raise RuntimeError("User store must contain a 'users' array.")
    changed = ensure_primary_developer_user(payload)
    changed = ensure_temporary_admin_user(payload) or changed
    if changed:
        save_user_store(payload)
    return payload


def list_auth_users() -> list[AuthUser]:
    payload = load_user_store()
    users: list[AuthUser] = []
    for record in payload.get("users", []):
        if not isinstance(record, dict):
            continue
        users.append(build_auth_user(record))
    return users


def sorted_user_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def sort_key(record: dict[str, Any]) -> tuple[int, str, str]:
        user = build_auth_user(record)
        return (
            0 if user.is_active else 1,
            0 if user.role == "developer" else 1 if user.role == "admin" else 2,
            (user.display_name or user.username).casefold(),
        )

    return sorted(records, key=sort_key)


def validate_designer_label_uniqueness(
    records: list[dict[str, Any]],
    *,
    username: str,
    role: str,
    display_name: str | None,
) -> None:
    if role != "designer":
        return

    candidate_label = normalize_display_name(display_name, username).casefold()
    for record in records:
        if not isinstance(record, dict):
            continue
        existing_user = build_auth_user(record)
        if normalize_username(existing_user.username) == username:
            continue
        if existing_user.role != "designer":
            continue
        if designer_label_for_user(existing_user).casefold() == candidate_label:
            raise ValueError("Designer display names must be unique among designer users.")


def find_auth_user(username: str) -> tuple[AuthUser, dict[str, Any]] | tuple[None, None]:
    payload = load_user_store()
    target = normalize_username(username)
    for record in payload.get("users", []):
        if not isinstance(record, dict):
            continue
        record_username = normalize_username(record.get("username"))
        if record_username != target:
            continue
        return build_auth_user(record), record
    return None, None

def current_user() -> AuthUser | None:
    identity = get_jwt_identity()
    if not identity:
        return None
    user, _record = find_auth_user(str(identity))
    if not user or not user.is_active:
        return None
    return user


def require_roles(*allowed_roles: str):
    normalized_allowed = {role.strip().lower() for role in allowed_roles if role.strip()}

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return jsonify({"error": "User not found."}), 404
            if user.role not in normalized_allowed:
                return jsonify({"error": "Forbidden."}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def require_owner(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "User not found."}), 404
        if not user.is_owner:
            return jsonify({"error": "Only the owner account can manage LinkedIn manual scheduling."}), 403
        return fn(*args, **kwargs)

    return wrapper


def require_owner_account_control(target_username: str) -> tuple[AuthUser | None, Any | None]:
    actor = current_user()
    if is_primary_developer_username(target_username) and (not actor or not actor.is_owner):
        return actor, (jsonify({"error": "Only the owner account can modify the owner account."}), 403)
    return actor, None
