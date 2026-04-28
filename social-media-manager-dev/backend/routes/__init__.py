from __future__ import annotations

from flask import Flask

from .assets import bp as assets_bp
from .auth import bp as auth_bp
from .diagnostics import bp as diagnostics_bp
from .pages import bp as pages_bp
from .planning import bp as planning_bp
from .posts import bp as posts_bp
from .settings import bp as settings_bp


BLUEPRINTS = (
    auth_bp,
    pages_bp,
    posts_bp,
    planning_bp,
    settings_bp,
    diagnostics_bp,
    assets_bp,
)


def register_blueprints(app: Flask) -> None:
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)
