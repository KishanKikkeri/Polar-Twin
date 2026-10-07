"""Version 1 of the POLARTWIN API."""

from fastapi import APIRouter

from app.api.v1 import runtime, stations

api_router = APIRouter()
api_router.include_router(stations.router)
api_router.include_router(runtime.router)
