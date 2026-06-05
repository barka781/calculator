"""Modèles ORM PostgreSQL.

Deux tables :
- products : catalogue cloud + services (TJM, support, actes) fusionnés.
- licenses : les licences (Microsoft SPLA, etc.), structure distincte.

Les colonnes clés sont en dur (requêtes/filtres rapides) ; les blocs
pricing/specs/metadata bruts sont conservés en JSONB pour ne rien perdre
du YAML d'origine.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Product(Base):
    """Produit du catalogue cloud ou service (unité chiffrable)."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(512))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Origine / classification
    catalog: Mapped[str] = mapped_column(String(32), index=True)  # cloud | services
    category: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    type: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    sub_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Prix
    public_price: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    discount_standard: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    engagement: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    base_quantity: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    min_quantity: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)

    # Blocs bruts (lossless)
    pricing: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    specs: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    item_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    source_file: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    catalog_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class License(Base):
    """Licence éditeur (catalogue licences.yaml)."""

    __tablename__ = "licenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(512))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    vendor: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    edition: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Prix
    public_price: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    purchase_price: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    term: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    engagement: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    validity_end: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Blocs bruts (lossless)
    pricing: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    item_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
