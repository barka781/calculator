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
    # Mode partenaire : applique la remise catalogue (taux par produit). Hors
    # mode partenaire (défaut), les prix restent publics (aucune remise auto).
    partner: bool = Field(default=False)
    # Remise additionnelle optionnelle (masquée dans l'UI publique, défaut 0).
    # Réservée au futur levier « remise d'engagement » ; conservée côté API.
    discount_percent: float = Field(default=0, ge=0, le=100)


class ExportQuoteRequest(QuoteRequest):
    """Devis à exporter : mêmes champs que QuoteRequest + métadonnées de présentation."""

    project: Optional[str] = None
    date: Optional[str] = None


class QuoteLineResponse(BaseModel):
    sku: str
    name: str
    source: Literal["catalog", "license"]
    unit: Optional[str] = None
    quantity: float
    # Prix unitaire NATIF (par terme) : mensuel pour le catalogue/licence mensuelle,
    # annuel/pluriannuel pour une licence à terme (ex. 7551.91 €/an), prix d'achat
    # pour une licence perpétuelle. `monthly_total` ci-dessous est le mensuel AMORTI.
    public_unit_price: float
    discounted_unit_price: float
    standard_discount_percent: float = 0
    # Terme tarifaire (None pour le catalogue/perpétuel) et nombre de mois couverts
    # par le prix natif (1 mensuel, 12 annuel, engagement×12 pluriannuel).
    term: Optional[str] = None
    term_months: int = 1
    # True = coût mensuel récurrent (amorti dans monthly_total) ; False = coût
    # ponctuel (licence perpétuelle / one-shot), porté par one_time_total.
    recurring: bool = True
    monthly_total: float = 0
    one_time_total: float = 0
    engagement_months: int = 1
    engagement_total: float = 0


class QuoteResponse(BaseModel):
    status: Literal["success"]
    currency: str = "EUR"
    period_months: int
    partner: bool = False
    discount_percent: float
    lines: list[QuoteLineResponse]
    # Totaux MENSUELS récurrents (licences perpétuelles / one-shot exclues).
    monthly_public_total: float
    monthly_discounted_total: float
    # Coûts PONCTUELS (à l'achat) : somme des licences perpétuelles / one-shot.
    one_time_total: float = 0
    # Projections = mensuel récurrent × période + coûts ponctuels (une seule fois).
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
