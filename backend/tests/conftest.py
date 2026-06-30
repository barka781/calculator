import pytest


@pytest.fixture(autouse=True)
def _enable_partner_in_tests(monkeypatch):
    """Active le mode partenaire pour l'environnement de test.

    Depuis que le mode partenaire est piloté par le déploiement
    (CALCULATOR_VIEW_PARTNER, défaut « non »), les tests de tarification partenaire
    n'auraient plus d'effet sans cette autorisation. Le gating par l'environnement
    lui-même est vérifié explicitement dans `test_view_partner_env_gates_pricing`,
    qui surcharge cette valeur dans les deux sens.
    """
    monkeypatch.setenv("CALCULATOR_VIEW_PARTNER", "yes")
