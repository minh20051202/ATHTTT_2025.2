def test_resolve_first_one_from_context():
    from backend.agents.intent import _resolve_product_ref, _agent_context
    agent_id = 999
    _agent_context[agent_id] = {
        "last_searched": [
            {"id": 10, "name": "Laptop", "price": 999.99},
            {"id": 20, "name": "Phone", "price": 699.99},
        ],
        "cart": [],
        "last_viewed": None,
    }
    assert _resolve_product_ref("first one", agent_id, None) == 10
    assert _resolve_product_ref("cheapest", agent_id, None) == 20
    assert _resolve_product_ref("second one", agent_id, None) == 20
    assert _resolve_product_ref("unknown ref", agent_id, None) is None


def test_get_agent_context_creates_fresh_context():
    from backend.agents.intent import get_agent_context, _agent_context
    agent_id = 888
    # Ensure clean state
    _agent_context.pop(agent_id, None)
    ctx = get_agent_context(agent_id)
    assert ctx["last_searched"] == []
    assert ctx["cart"] == []
    assert ctx["last_viewed"] is None


def test_resolve_product_ref_empty_last_searched():
    from backend.agents.intent import _resolve_product_ref, _agent_context
    agent_id = 777
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [],
        "last_viewed": None,
    }
    assert _resolve_product_ref("first one", agent_id, None) is None
    assert _resolve_product_ref("cheapest", agent_id, None) is None


def test_resolve_product_ref_most_expensive():
    from backend.agents.intent import _resolve_product_ref, _agent_context
    agent_id = 666
    _agent_context[agent_id] = {
        "last_searched": [
            {"id": 10, "name": "Laptop", "price": 999.99},
            {"id": 20, "name": "Phone", "price": 699.99},
            {"id": 30, "name": "Tablet", "price": 399.99},
        ],
        "cart": [],
        "last_viewed": None,
    }
    assert _resolve_product_ref("most expensive", agent_id, None) == 10
    assert _resolve_product_ref("highest price", agent_id, None) == 10
    assert _resolve_product_ref("priciest", agent_id, None) == 10