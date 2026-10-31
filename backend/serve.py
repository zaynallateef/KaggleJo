"""Waitress production entrypoint, supported on Windows and Linux."""
import os
from waitress import serve
from backend.app import create_app

if __name__ == '__main__':
    serve(create_app(), host=os.getenv('HOST', '0.0.0.0'), port=int(os.getenv('PORT', '8000')), threads=4)
