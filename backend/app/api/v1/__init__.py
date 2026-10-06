"""Version 1 of the POLARTWIN API."""

from fastapi import APIRouter

from app.api.v1 import stations

api_router = APIRouter()
api_router.include_router(stations.router)
