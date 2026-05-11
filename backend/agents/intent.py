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
            prompt = f"""
You are an AI Agent intent extractor. Analyze the user's message and extract the intent.

User message: "{user_message}"

Rules:
- If the user wants to BUY or PURCHASE something, return "execute_purchase" with product_name in parameters. The server will resolve the name to a product_id via DB lookup.
- If the user asks to SEARCH, BROWSE, or SHOW products, return "search_products" with product_name or max_price.
- If the user provides an exact product_id, use execute_purchase with product_id.
- When ambiguous (multiple matches possible), execute_purchase uses the first matching product.

Actions available: "search_products", "compare_prices", "execute_purchase", "get_product_details"

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
"""

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
            "compare_prices": self._compare_prices,
            "execute_purchase": self._execute_purchase,
            "get_product_details": self._get_product_details
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
        if intent.action in ("search_products", "get_product_details", "execute_purchase"):
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

    async def _compare_prices(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int]
    ) -> Dict[str, Any]:
        """Compare prices of products."""
        product_ids = params.get("product_ids", [])
        return {
            "action": "compare_prices",
            "comparisons": [
                {"id": 1, "name": "Laptop", "price": 999.99},
                {"id": 2, "name": "Phone", "price": 699.99}
            ],
            "cheapest": {"id": 2, "name": "Phone", "price": 699.99}
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


intent_extractor = IntentExtraction()
tool_caller = ToolCaller()
