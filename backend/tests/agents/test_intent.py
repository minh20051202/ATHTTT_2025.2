import pytest
from backend.agents.intent import _resolve_product_ref, _agent_context, get_agent_context


def test_resolve_first_one_from_context():
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
    agent_id = 888
    _agent_context.pop(agent_id, None)
    ctx = get_agent_context(agent_id)
    assert ctx["last_searched"] == []
    assert ctx["cart"] == []
    assert ctx["last_viewed"] is None


def test_resolve_product_ref_empty_last_searched():
    agent_id = 777
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [],
        "last_viewed": None,
    }
    assert _resolve_product_ref("first one", agent_id, None) is None
    assert _resolve_product_ref("cheapest", agent_id, None) is None


def test_resolve_product_ref_most_expensive():
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


@pytest.mark.asyncio
async def test_add_to_cart_increases_count():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1001
    _agent_context.pop(agent_id, None)
    ctx = get_agent_context(agent_id)
    assert ctx["cart"] == []

    intent = Intent(action="add_to_cart", parameters={"product_id": 5, "quantity": 2})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["action"] == "add_to_cart"
    assert result["product_id"] == 5
    assert result["quantity"] == 2
    assert result["cart_count"] == 1
    assert ctx["cart"] == [{"product_id": 5, "quantity": 2}]


@pytest.mark.asyncio
async def test_add_to_cart_existing_item_increments_quantity():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1002
    _agent_context[agent_id] = {"last_searched": [], "cart": [{"product_id": 3, "quantity": 1}], "last_viewed": None}

    intent = Intent(action="add_to_cart", parameters={"product_id": 3, "quantity": 4})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["quantity"] == 4
    assert _agent_context[agent_id]["cart"] == [{"product_id": 3, "quantity": 5}]


@pytest.mark.asyncio
async def test_view_cart_empty():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1003
    _agent_context.pop(agent_id, None)
    get_agent_context(agent_id)

    intent = Intent(action="view_cart", parameters={})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["action"] == "view_cart"
    assert result["items"] == []
    assert result["total"] == 0
    assert result["count"] == 0


@pytest.mark.asyncio
async def test_remove_from_cart():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1004
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 7, "quantity": 2}, {"product_id": 9, "quantity": 1}],
        "last_viewed": None,
    }

    intent = Intent(action="remove_from_cart", parameters={"product_id": 7})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["action"] == "remove_from_cart"
    assert result["removed"] is True
    assert _agent_context[agent_id]["cart"] == [{"product_id": 9, "quantity": 1}]


@pytest.mark.asyncio
async def test_remove_from_cart_not_found():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1005
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 7, "quantity": 2}],
        "last_viewed": None,
    }

    intent = Intent(action="remove_from_cart", parameters={"product_id": 99})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["removed"] is False
    assert _agent_context[agent_id]["cart"] == [{"product_id": 7, "quantity": 2}]


@pytest.mark.asyncio
async def test_update_cart_quantity_updates_qty():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1006
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 4, "quantity": 2}],
        "last_viewed": None,
    }

    intent = Intent(action="update_cart_quantity", parameters={"product_id": 4, "quantity": 5})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["removed"] is False
    assert result["quantity"] == 5
    assert _agent_context[agent_id]["cart"] == [{"product_id": 4, "quantity": 5}]


@pytest.mark.asyncio
async def test_update_cart_quantity_removes_when_zero():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1007
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 4, "quantity": 2}],
        "last_viewed": None,
    }

    intent = Intent(action="update_cart_quantity", parameters={"product_id": 4, "quantity": 0})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["removed"] is True
    assert result["quantity"] == 0
    assert _agent_context[agent_id]["cart"] == []


@pytest.mark.asyncio
async def test_update_cart_quantity_removes_when_negative():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 1008
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 4, "quantity": 2}],
        "last_viewed": None,
    }

    intent = Intent(action="update_cart_quantity", parameters={"product_id": 4, "quantity": -1})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["removed"] is True
    assert _agent_context[agent_id]["cart"] == []


# Cart management tests with specified agent_ids

@pytest.mark.asyncio
async def test_add_to_cart():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 999
    _agent_context.pop(agent_id, None)
    get_agent_context(agent_id)

    intent = Intent(action="add_to_cart", parameters={"product_id": 1, "quantity": 2})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["action"] == "add_to_cart"
    assert result["product_id"] == 1
    assert result["quantity"] == 2


@pytest.mark.asyncio
async def test_view_cart_with_items(db, sample_products):
    from backend.agents.intent import Intent, tool_caller

    agent_id = 888
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": sample_products[0].id, "quantity": 2}, {"product_id": sample_products[1].id, "quantity": 1}],
        "last_viewed": None,
    }

    intent = Intent(action="view_cart", parameters={})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, db)

    assert result["action"] == "view_cart"
    assert result["count"] == 2
    assert result["total"] > 0
    # Clean up
    _agent_context[agent_id]["cart"] = []


@pytest.mark.asyncio
async def test_remove_from_cart():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 777
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 3, "quantity": 1}],
        "last_viewed": None,
    }

    intent = Intent(action="remove_from_cart", parameters={"product_id": 3})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["removed"] is True


@pytest.mark.asyncio
async def test_update_cart_quantity():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 666
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 5, "quantity": 1}],
        "last_viewed": None,
    }

    # Update qty to 3
    intent = Intent(action="update_cart_quantity", parameters={"product_id": 5, "quantity": 3})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["quantity"] == 3
    assert result["removed"] is False

    # Set to 0 — should be removed
    intent = Intent(action="update_cart_quantity", parameters={"product_id": 5, "quantity": 0})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["quantity"] == 0
    assert result["removed"] is True


@pytest.mark.asyncio
async def test_update_cart_quantity_nonexistent():
    from backend.agents.intent import Intent, tool_caller

    agent_id = 667
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [{"product_id": 5, "quantity": 1}],
        "last_viewed": None,
    }

    intent = Intent(action="update_cart_quantity", parameters={"product_id": 9999, "quantity": 3})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert result["updated"] is False
    assert result["removed"] is False


@pytest.mark.asyncio
async def test_checkout_empty_cart_raises():
    from backend.agents.intent import Intent, tool_caller, get_agent_context
    from backend.utils.errors import AppError

    agent_id = 555
    _agent_context.pop(agent_id, None)
    get_agent_context(agent_id)
    assert get_agent_context(agent_id)["cart"] == []

    intent = Intent(action="checkout", parameters={})
    with pytest.raises(AppError) as exc_info:
        await tool_caller.call_tool(intent, "oauth2", agent_id, None)

    assert "empty" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_checkout_success(db, sample_products):
    from backend.agents.intent import Intent, tool_caller, get_agent_context

    agent_id = 555
    _agent_context[agent_id] = {
        "last_searched": [],
        "cart": [
            {"product_id": sample_products[0].id, "quantity": 2},
            {"product_id": sample_products[1].id, "quantity": 3},
        ],
        "last_viewed": None,
    }

    intent = Intent(action="checkout", parameters={})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id, db)

    assert result["action"] == "checkout"
    assert result["transaction_id"] is not None
    assert result["total"] > 0
    assert result["status"] == "completed"
    assert get_agent_context(agent_id)["cart"] == []


@pytest.mark.asyncio
async def test_get_order_history(db):
    from backend.agents.intent import tool_caller, Intent
    from backend.db.models import Transaction

    # Create a transaction for agent 1
    t = Transaction(
        agent_id=1,
        product_id=1,
        product_ids="1,2",
        amount=5,
        total_price=49.99,
        auth_type_used="oauth2",
        status="completed"
    )
    db.add(t)
    db.commit()

    intent = Intent(action="get_order_history", parameters={"limit": 5})
    result = await tool_caller.call_tool(intent, "oauth2", agent_id=1, db=db)

    assert result["action"] == "get_order_history"
    assert result["total"] >= 1
    assert result["limit"] == 5
    assert len(result["orders"]) >= 1
    assert result["orders"][0]["total"] == 49.99


@pytest.mark.asyncio
async def test_get_order_history_includes_same_user_agent_transactions(
    db,
    oauth2_pkjwt_agent,
    zkp_agent,
    sample_products,
):
    """Order history is user-scoped, so OAuth2 and ZKP agents see the same user's orders."""
    from backend.agents.intent import Intent, tool_caller
    from backend.db.models import Transaction

    older = Transaction(
        agent_id=oauth2_pkjwt_agent.id,
        product_id=sample_products[0].id,
        product_ids=str(sample_products[0].id),
        amount=1,
        total_price=sample_products[0].price,
        auth_type_used="oauth2",
        status="completed",
    )
    newer = Transaction(
        agent_id=zkp_agent.id,
        product_id=sample_products[1].id,
        product_ids=str(sample_products[1].id),
        amount=1,
        total_price=sample_products[1].price,
        auth_type_used="zkp",
        status="completed",
    )
    db.add_all([older, newer])
    db.commit()
    db.refresh(older)
    db.refresh(newer)

    intent = Intent(action="get_order_history", parameters={"limit": 10})
    result = await tool_caller.call_tool(intent, "oauth2", oauth2_pkjwt_agent.id, db)

    transaction_ids = [order["transaction_id"] for order in result["orders"]]
    assert newer.id in transaction_ids
    assert older.id in transaction_ids
    assert result["orders"][0]["transaction_id"] == newer.id
    assert result["orders"][0]["auth_type_used"] == "zkp"
