from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from ..utils.config import settings
from ..utils.errors import AppError, ErrorCode
import httpx
import time
import json


# Module-level per-agent context store
_agent_context: Dict[int, Dict[str, Any]] = {}


def get_agent_context(agent_id: int) -> Dict[str, Any]:
    """Get or create per-agent context dict."""
    if agent_id not in _agent_context:
        _agent_context[agent_id] = {
            "last_searched": [],   # List[dict] — products from last search
            "cart": [],            # List[dict] — {"product_id": int, "quantity": int}
            "last_viewed": None,   # dict — last viewed product
        }
    return _agent_context[agent_id]


def _resolve_product_ref(ref: str, agent_id: int, db: Any) -> Optional[int]:
    """Resolve context references to a product_id.

    Handles: "first one", "second one", "cheapest", "most expensive", etc.
    Returns product_id (int) or None if no match.
    """
    ctx = get_agent_context(agent_id)
    last_searched = ctx.get("last_searched", [])

    if not last_searched:
        return None

    ref_lower = ref.lower().strip()

    # Positional references
    if ref_lower in ("first one", "first", "the first", "it", "that one"):
        return last_searched[0]["id"]

    if ref_lower in ("second one", "second", "the second"):
        if len(last_searched) > 1:
            return last_searched[1]["id"]
        return None

    # Price-based references
    if ref_lower in ("cheapest", "lowest price", "least expensive"):
        return min(last_searched, key=lambda p: p["price"])["id"]

    if ref_lower in ("most expensive", "highest price", "priciest"):
        return max(last_searched, key=lambda p: p["price"])["id"]

    return None


class Intent(BaseModel):
    """Extracted intent from natural language."""
    action: str = Field(..., description="The action to perform")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters for the action")
    confidence: float = Field(default=1.0, description="Confidence score")


class IntentExtraction:
    """Extract user intents using NVIDIA NIM."""

    def __init__(self):
        self.base_url = settings.nim_base_url
        self.api_key = settings.nim_api_key
        self.model = "minimaxai/minimax-m2.7"  # Default model

    async def extract_intent(self, user_message: str) -> Intent:
        """Extract intent from natural language message."""
        start_time = time.time()

        try:
            prompt = f"""You are an AI Commerce Agent intent extractor. Analyze the user's message and extract the intent.

User message: "{user_message}"

Rules:
- If the user wants to BUY or PURCHASE something, return "execute_purchase" with product_name or product_id in parameters.
- If the user provides an exact product_id, use execute_purchase with product_id directly.
- If the user asks to SEARCH, BROWSE, SHOW, or FIND products, return "search_products" with product_name, category, or max_price.
- If the user wants to ADD an item to their cart, return "add_to_cart" with product_name or product_id and quantity.
- If the user wants to VIEW their cart, return "view_cart" with no parameters.
- If the user wants to REMOVE an item from cart, return "remove_from_cart" with product_id.
- If the user wants to UPDATE item quantity in cart, return "update_cart_quantity" with product_id and quantity.
- If the user says CHECKOUT, BUY NOW, or CONFIRM ORDER, return "checkout" with no parameters.
- If the user wants to COMPARE products, return "compare_products" with product_ids or product_names (list) or category.
- If the user wants product DETAILS or DESCRIPTION, return "get_product_details" with product_id or product_name.
- If the user wants to see their ORDER HISTORY or PAST ORDERS, return "get_order_history" with optional limit and offset.
- Context references ("first one", "cheapest", "that one", "it") resolve to a previously-searched product — include as product_name for server-side resolution.
- When multiple products match, use the first match (lowest id).

Actions available: "search_products", "compare_products", "execute_purchase", "get_product_details", "add_to_cart", "view_cart", "remove_from_cart", "update_cart_quantity", "checkout", "get_order_history"

Respond in JSON format only:
{{
    "action": "action_name",
    "parameters": {{"key": "value"}},
    "confidence": 0.95
}}

Examples:
- "buy smartphone" → {{"action": "execute_purchase", "parameters": {{"product_name": "smartphone"}}, "confidence": 0.95}}
- "purchase a laptop" → {{"action": "execute_purchase", "parameters": {{"product_name": "laptop"}}, "confidence": 0.95}}
- "show me phones" → {{"action": "search_products", "parameters": {{"product_name": "phone"}}, "confidence": 0.9}}
- "search for headphones under 100" → {{"action": "search_products", "parameters": {{"product_name": "headphones", "max_price": 100}}, "confidence": 0.95}}
- "buy phone id 3" → {{"action": "execute_purchase", "parameters": {{"product_id": 3}}, "confidence": 0.95}}
- "add laptop to my cart" → {{"action": "add_to_cart", "parameters": {{"product_name": "laptop", "quantity": 1}}, "confidence": 0.95}}
- "show my cart" → {{"action": "view_cart", "parameters": {{}}, "confidence": 0.95}}
- "remove the phone from my cart" → {{"action": "remove_from_cart", "parameters": {{"product_id": 3}}, "confidence": 0.95}}
- "change quantity to 3" → {{"action": "update_cart_quantity", "parameters": {{"product_id": 3, "quantity": 3}}, "confidence": 0.9}}
- "checkout" → {{"action": "checkout", "parameters": {{}}, "confidence": 0.95}}
- "compare laptop and phone" → {{"action": "compare_products", "parameters": {{"product_names": ["laptop", "phone"]}}, "confidence": 0.95}}
- "compare prices for electronics" → {{"action": "compare_products", "parameters": {{"category": "electronics"}}, "confidence": 0.9}}
- "tell me about the first one" → {{"action": "get_product_details", "parameters": {{"product_name": "first one"}}, "confidence": 0.8}}
- "show my order history" → {{"action": "get_order_history", "parameters": {{}}, "confidence": 0.95}}"""

            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }

            payload = {
                "model": self.model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.3,
                "max_tokens": 500
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload
                )
                response.raise_for_status()

                result = response.json()
                content = result["choices"][0]["message"]["content"].strip()

                # Strip markdown code fences if present
                if content.startswith("```"):
                    content = content.split("```")[1]
                    content = content.lstrip("json\n").rstrip("`").strip()

                # Parse JSON response
                intent_data = json.loads(content)
                extraction_time = time.time() - start_time

                intent = Intent(**intent_data)
                return intent

        except httpx.HTTPStatusError as e:
            raise AppError(
                error_code=ErrorCode.NIM_API_ERROR,
                message=f"NVIDIA NIM API error: {str(e)}",
                status_code=e.response.status_code
            )
        except Exception as e:
            raise AppError(
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                message=f"Failed to extract intent: {str(e)}",
                status_code=500
            )


class ToolCaller:
    """Call tools based on extracted intent."""

    def __init__(self):
        self.available_tools = {
            "search_products": self._search_products,
            "compare_products": self._compare_products,
            "execute_purchase": self._execute_purchase,
            "get_product_details": self._get_product_details,
            "add_to_cart": self._add_to_cart,
            "view_cart": self._view_cart,
            "remove_from_cart": self._remove_from_cart,
            "update_cart_quantity": self._update_cart_quantity,
            "checkout": self._checkout,
            "get_order_history": self._get_order_history,
        }

    async def call_tool(
        self,
        intent: Intent,
        auth_type: str,
        agent_id: Optional[int] = None,
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Call the appropriate tool based on intent."""
        start_time = time.time()

        if intent.action not in self.available_tools:
            raise AppError(
                error_code=ErrorCode.INVALID_OPERATION,
                message=f"Unknown action: {intent.action}",
                status_code=400
            )

        # Call the tool
        tool_fn = self.available_tools[intent.action]
        if intent.action in ("search_products", "compare_products", "execute_purchase", "add_to_cart", "view_cart", "remove_from_cart", "update_cart_quantity", "checkout", "get_order_history"):
            result = await tool_fn(intent.parameters, auth_type, agent_id, db)
        else:
            result = await tool_fn(intent.parameters, auth_type, agent_id)

        execution_time = time.time() - start_time
        result["execution_time"] = execution_time
        result["auth_type_used"] = auth_type

        return result

    async def _search_products(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Search for products in the database."""
        from ..db.models import Product

        query = db.query(Product) if db else None

        results = []
        if query is not None:
            product_name = params.get("product_name", "").strip().lower()
            category = params.get("category", "").strip().lower()
            max_price = params.get("max_price")

            if product_name:
                query = query.filter(Product.name.ilike(f"%{product_name}%"))
            if category:
                query = query.filter(Product.category.ilike(f"%{category}%"))
            if max_price is not None:
                query = query.filter(Product.price <= float(max_price))

            rows = query.limit(20).all()
            results = [
                {
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "price": p.price,
                    "stock": p.stock,
                    "category": p.category,
                }
                for p in rows
            ]
        else:
            # Fallback if no DB session
            results = [
                {"id": 1, "name": "Laptop", "price": 999.99, "stock": 10},
                {"id": 2, "name": "Phone", "price": 699.99, "stock": 15}
            ]

        # Store results in agent context
        if agent_id is not None:
            ctx = get_agent_context(agent_id)
            ctx["last_searched"] = results

        return {
            "action": "search_products",
            "results": results,
            "count": len(results)
        }

    async def _compare_products(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Compare prices of products using DB query with flexible OR conditions."""
        from sqlalchemy import or_
        from ..db.models import Product

        comparisons = []
        cheapest = None

        if db is not None:
            query = db.query(Product)

            product_ids = params.get("product_ids", [])
            product_names = params.get("product_names", [])
            category = params.get("category", "").strip()

            # Build filter conditions
            filters = []

            if product_ids:
                filters.append(Product.id.in_(product_ids))

            if product_names:
                name_filters = [Product.name.ilike(f"%{n}%") for n in product_names]
                filters.append(or_(*name_filters))

            if category:
                filters.append(Product.category.ilike(f"%{category}%"))

            # Apply filters if any
            if filters:
                query = query.filter(*filters)

            rows = query.limit(10).all()
            comparisons = [
                {
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "price": p.price,
                    "stock": p.stock,
                    "category": p.category,
                }
                for p in rows
            ]

            # Find cheapest
            if comparisons:
                cheapest = min(comparisons, key=lambda p: p["price"])
        else:
            # Fallback if no DB session
            comparisons = [
                {"id": 1, "name": "Laptop", "price": 999.99},
                {"id": 2, "name": "Phone", "price": 699.99}
            ]
            cheapest = {"id": 2, "name": "Phone", "price": 699.99}

        # Store in agent context
        if agent_id is not None:
            ctx = get_agent_context(agent_id)
            ctx["last_searched"] = comparisons

        return {
            "action": "compare_products",
            "comparisons": comparisons,
            "count": len(comparisons),
            "cheapest": cheapest
        }

    async def _execute_purchase(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Execute a purchase. Resolves product_name to product_id via context ref or DB."""
        from ..db.models import Product

        product_id = params.get("product_id")
        product_name = params.get("product_name")

        # First try context-aware resolution if product_id not provided
        if product_id is None and product_name and agent_id is not None:
            product_id = _resolve_product_ref(product_name, agent_id, db)

        # Fall back to DB lookup if context resolution didn't find anything
        if product_id is None and product_name and db:
            rows = db.query(Product).filter(
                Product.name.ilike(f"%{product_name.strip()}%")
            ).limit(1).all()
            if rows:
                product_id = rows[0].id
            else:
                raise AppError(
                    error_code=ErrorCode.INVALID_OPERATION,
                    message=f"No product found matching '{product_name}'. Try search_products first.",
                    status_code=400
                )

        if product_id is None:
            raise AppError(
                error_code=ErrorCode.MISSING_PARAMETER,
                message="product_id is required. Specify a product name or search first.",
                status_code=400
            )

        quantity = params.get("quantity", 1)

        # Get actual product price from DB
        unit_price = 999.99
        if db:
            product = db.query(Product).filter(Product.id == product_id).first()
            if product:
                unit_price = product.price
            else:
                raise AppError(
                    error_code=ErrorCode.RESOURCE_NOT_FOUND,
                    message=f"Product {product_id} not found",
                    status_code=404
                )

        return {
            "action": "execute_purchase",
            "product_id": product_id,
            "quantity": quantity,
            "total": unit_price * quantity,
            "status": "completed"
        }

    async def _get_product_details(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Get product details from DB, populating last_viewed in agent context."""
        from ..db.models import Product

        product_id = params.get("product_id")
        product_name = params.get("product_name")

        product = None

        # First try context-aware resolution if product_id not provided
        if product_id is None and product_name and agent_id is not None:
            resolved_id = _resolve_product_ref(product_name, agent_id, db)
            if resolved_id is not None:
                product_id = resolved_id

        if db is not None:
            if product_id is not None:
                product = db.query(Product).filter(Product.id == product_id).first()
            elif product_name:
                product = db.query(Product).filter(
                    Product.name.ilike(f"%{product_name.strip()}%")
                ).limit(1).first()

        if product is None:
            raise AppError(
                error_code=ErrorCode.RESOURCE_NOT_FOUND,
                message="Product not found",
                status_code=404
            )

        product_dict = {
            "id": product.id,
            "name": product.name,
            "description": product.description,
            "price": product.price,
            "stock": product.stock,
            "category": product.category,
        }

        # Populate last_viewed in agent context
        if agent_id is not None:
            ctx = get_agent_context(agent_id)
            ctx["last_viewed"] = product_dict

        return {
            "action": "get_product_details",
            "product": product_dict
        }

    async def _add_to_cart(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        from ..db.models import Product

        product_id = params.get("product_id")
        product_name = params.get("product_name")
        quantity = params.get("quantity", 1)

        # Resolve product_name to product_id via DB if needed
        if not product_id and product_name and db:
            rows = db.query(Product).filter(Product.name.ilike(f"%{product_name.strip()}%")).limit(1).all()
            if rows:
                product_id = rows[0].id
            else:
                raise AppError(error_code=ErrorCode.RESOURCE_NOT_FOUND, message=f"No product found: {product_name}", status_code=404)
        if not product_id:
            raise AppError(error_code=ErrorCode.MISSING_PARAMETER, message="product_id or product_name required", status_code=400)

        ctx = get_agent_context(agent_id)
        cart = ctx["cart"]

        existing = next((item for item in cart if item["product_id"] == product_id), None)
        if existing:
            existing["quantity"] += quantity
        else:
            cart.append({"product_id": product_id, "quantity": quantity})

        return {
            "action": "add_to_cart",
            "product_id": product_id,
            "quantity": quantity,
            "cart_count": len(cart),
            "message": f"Added to cart (qty: {quantity})",
        }

    async def _view_cart(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        from ..db.models import Product

        ctx = get_agent_context(agent_id)
        cart = ctx.get("cart", [])

        if not cart:
            return {"action": "view_cart", "items": [], "total": 0, "count": 0}

        product_ids = [item["product_id"] for item in cart]
        products = db.query(Product).filter(Product.id.in_(product_ids)).all() if db else []
        product_map = {p.id: p for p in products}

        items = []
        total = 0
        for item in cart:
            product = product_map.get(item["product_id"])
            if product:
                item_total = product.price * item["quantity"]
                items.append({
                    "product_id": product.id,
                    "name": product.name,
                    "quantity": item["quantity"],
                    "unit_price": product.price,
                    "subtotal": item_total,
                })
                total += item_total

        return {
            "action": "view_cart",
            "items": items,
            "total": round(total, 2),
            "count": len(items),
        }

    async def _remove_from_cart(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        product_id = params.get("product_id")
        if not product_id:
            raise AppError(error_code=ErrorCode.MISSING_PARAMETER, message="product_id required", status_code=400)

        ctx = get_agent_context(agent_id)
        cart = ctx.get("cart", [])
        original_len = len(cart)
        ctx["cart"] = [item for item in cart if item["product_id"] != product_id]

        removed = len(ctx["cart"]) < original_len
        return {
            "action": "remove_from_cart",
            "product_id": product_id,
            "removed": removed,
            "remaining_count": len(ctx["cart"]),
        }

    async def _update_cart_quantity(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        product_id = params.get("product_id")
        quantity = params.get("quantity", 0)

        if not product_id:
            raise AppError(error_code=ErrorCode.MISSING_PARAMETER, message="product_id required", status_code=400)

        ctx = get_agent_context(agent_id)
        cart = ctx.get("cart", [])

        if quantity <= 0:
            ctx["cart"] = [item for item in cart if item["product_id"] != product_id]
            return {"action": "update_cart_quantity", "product_id": product_id, "quantity": 0, "removed": True}

        found = False
        for item in cart:
            if item["product_id"] == product_id:
                item["quantity"] = quantity
                found = True
                break

        return {
            "action": "update_cart_quantity",
            "product_id": product_id,
            "quantity": quantity if found else 0,
            "removed": False,
            "updated": found,
        }

    async def _checkout(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        # Note: params unused — checkout always consumes cart from context
        from ..db.models import Product, Transaction

        ctx = get_agent_context(agent_id)
        cart = ctx.get("cart", [])

        if not cart:
            raise AppError(
                error_code=ErrorCode.INVALID_OPERATION,
                message="Cart is empty",
                status_code=400
            )

        if not db:
            raise AppError(
                error_code=ErrorCode.INVALID_OPERATION,
                message="DB required for checkout",
                status_code=500
            )

        product_ids = [item["product_id"] for item in cart]
        products = db.query(Product).filter(Product.id.in_(product_ids)).all()
        product_map = {p.id: p for p in products}

        items = []
        quantities = []
        total = 0.0

        for item in cart:
            product = product_map.get(item["product_id"])
            if not product:
                raise AppError(
                    error_code=ErrorCode.RESOURCE_NOT_FOUND,
                    message=f"Product {item['product_id']} not found",
                    status_code=404
                )
            if product.stock < item["quantity"]:
                raise AppError(
                    error_code=ErrorCode.INVALID_OPERATION,
                    message=f"Insufficient stock for '{product.name}': requested {item['quantity']}, available {product.stock}",
                    status_code=400
                )
            product.stock -= item["quantity"]
            subtotal = product.price * item["quantity"]
            items.append({
                "product_id": product.id,
                "name": product.name,
                "quantity": item["quantity"],
                "unit_price": product.price,
                "subtotal": subtotal,
            })
            quantities.append(item["quantity"])
            total += subtotal

        all_product_ids = ",".join(str(pid) for pid in product_ids)
        transaction = Transaction(
            agent_id=agent_id,
            product_id=product_ids[0] if product_ids else None,
            product_ids=all_product_ids,
            amount=sum(quantities),
            total_price=round(total, 2),
            auth_type_used=auth_type,
            status="completed"
        )
        db.add(transaction)
        db.commit()

        ctx["cart"] = []

        return {
            "action": "checkout",
            "items": items,
            "total": round(total, 2),
            "transaction_id": transaction.id,
            "status": "completed",
            "message": f"Order placed. Transaction #{transaction.id}"
        }

    async def _get_order_history(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int],
        db: Optional[Any] = None
    ) -> Dict[str, Any]:
        from ..db.models import Transaction

        if not db:
            return {"action": "get_order_history", "orders": []}

        limit = params.get("limit", 10)
        offset = params.get("offset", 0)

        query = db.query(Transaction).filter(Transaction.agent_id == agent_id)
        total = query.count()
        transactions = query.order_by(Transaction.created_at.desc()).offset(offset).limit(limit).all()

        orders = []
        for t in transactions:
            product_ids = [int(pid) for pid in t.product_ids.split(",")] if t.product_ids else []

            items = []
            if product_ids and t.amount:
                qty_per_item = t.amount // len(product_ids)
                extra = t.amount % len(product_ids)
                for i, pid in enumerate(product_ids):
                    qty = qty_per_item + (1 if i < extra else 0)
                    items.append({"product_id": pid, "quantity": qty})
            elif product_ids:
                for pid in product_ids:
                    items.append({"product_id": pid, "quantity": 1})

            orders.append({
                "transaction_id": t.id,
                "items": items,
                "total": t.total_price,
                "status": t.status,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            })

        return {
            "action": "get_order_history",
            "orders": orders,
            "total": total,
            "limit": limit,
            "offset": offset,
        }


intent_extractor = IntentExtraction()
tool_caller = ToolCaller()
