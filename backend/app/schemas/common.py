"""Shared schema primitives and the error envelope."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=False)


class ErrorDetail(ApiModel):
    code: str = Field(description="Stable machine-readable code, e.g. STATION_NOT_FOUND")
    message: str = Field(description="Human-readable explanation")
    details: Any | None = Field(default=None, description="Optional structured context (e.g. validation errors)")


class ErrorResponse(ApiModel):
    """Envelope returned for every non-2xx response."""

    error: ErrorDetail

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "error": {
                    "code": "STATION_NOT_FOUND",
                    "message": "Station 'vostok' does not exist",
                    "details": {"station_id": "vostok", "known_station_ids": ["bharati", "maitri"]},
                }
            }
        }
    )


class Coordinates(ApiModel):
    lat: float = Field(ge=-90, le=90, description="WGS84 latitude, decimal degrees")
    lon: float = Field(ge=-180, le=180, description="WGS84 longitude, decimal degrees")


# Reusable OpenAPI response docs for routers.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Resource not found"},
    422: {"model": ErrorResponse, "description": "Request validation failed"},
}
