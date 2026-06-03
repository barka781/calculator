from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ProductSummary(BaseModel):
    sku: Optional[str] = None
    name: str
    description: Optional[str] = None
    category: str
    type: str
    sub_type: str
    unit: str = "unite"
    pricing: dict[str, Any] = Field(default_factory=dict)
    pricing_summary: dict[str, Any] = Field(default_factory=dict)
    specs: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_file: Optional[str] = None


class LicenseSummary(BaseModel):
    sku: Optional[str] = None
    name: str
    description: Optional[str] = None
    vendor: Optional[str] = None
    edition: Optional[str] = None
    category: str = "Licence"
    type: Optional[str] = None
    unit: Optional[str] = None
    pricing: dict[str, Any] = Field(default_factory=dict)
    price: Optional[float] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class QuoteLineRequest(BaseModel):
    sku: str
    quantity: float = Field(default=1, gt=0)
    source: Literal["auto", "catalog", "license"] = "auto"
    label: Optional[str] = None


class QuoteRequest(BaseModel):
    lines: list[QuoteLineRequest] = Field(default_factory=list)
    period_months: int = Field(default=12, ge=1, le=120)
    discount_percent: float = Field(default=0, ge=0, le=100)


class QuoteLineResponse(BaseModel):
    sku: str
    name: str
    source: Literal["catalog", "license"]
    unit: Optional[str] = None
    quantity: float
    public_unit_price: float
    discounted_unit_price: float
    standard_discount_percent: float = 0
    monthly_total: float
    engagement_months: int = 1
    engagement_total: float = 0


class QuoteResponse(BaseModel):
    status: Literal["success"]
    currency: str = "EUR"
    period_months: int
    discount_percent: float
    lines: list[QuoteLineResponse]
    monthly_public_total: float
    monthly_discounted_total: float
    period_public_total: float
    period_discounted_total: float
    savings_total: float
    total_on_engagement: float = 0


class VmSpec(BaseModel):
    name: Optional[str] = None
    vcpu: float = Field(default=0, ge=0)
    ram_gb: float = Field(default=0, ge=0)
    storage_gb: float = Field(default=0, ge=0)


class ArchitectureRequest(BaseModel):
    vms: list[VmSpec] = Field(default_factory=list)
    ha_required: bool = False
