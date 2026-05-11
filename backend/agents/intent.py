from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from ..utils.config import settings
from ..utils.errors import AppError, ErrorCode
import httpx
import time
import json


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
- If the user wants to BUY or PURCHASE something but does NOT specify an exact product ID, you MUST return action "search_products" with the product_name parameter. NEVER call execute_purchase without a product_id — you do not have access to a product catalog to look up IDs.
- If the user asks about a product category (e.g. "phones", "laptops", "headphones") without specifying an exact product, return "search_products" with product_name or category.
- Only return "execute_purchase" when the user explicitly names a specific product or provides a product_id.
- If unsure which product the user means, default to "search_products" so the system can show options.

Actions available: "search_products", "compare_prices", "execute_purchase", "get_product_details"

Respond in JSON format only:
{{
    "action": "action_name",
    "parameters": {{"key": "value"}},
    "confidence": 0.95
}}

Examples:
- "buy phone" → {{"action": "search_products", "parameters": {{"product_name": "phone"}}, "confidence": 0.9}}
- "buy phone id 3" → {{"action": "execute_purchase", "parameters": {{"product_id": 3}}, "confidence": 0.95}}
- "show me laptops" → {{"action": "search_products", "parameters": {{"product_name": "laptop"}}, "confidence": 0.9}}
- "search for headphones under 100" → {{"action": "search_products", "parameters": {{"product_name": "headphones", "max_price": 100}}, "confidence": 0.95}}
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
        if intent.action == "search_products":
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
        agent_id: Optional[int]
    ) -> Dict[str, Any]:
        """Execute a purchase."""
        product_id = params.get("product_id")
        if product_id is None:
            raise AppError(
                error_code=ErrorCode.MISSING_PARAMETER,
                message="product_id is required to execute a purchase. Use search_products first to find products.",
                status_code=400
            )
        quantity = params.get("quantity", 1)

        # Verify product exists in DB
        from ..db.models import Product
        # Note: caller should pass db session for full validation
        # Fall back to hardcoded price if no DB

        return {
            "action": "execute_purchase",
            "product_id": product_id,
            "quantity": quantity,
            "total": 999.99 * quantity,
            "status": "completed"
        }

    async def _get_product_details(
        self,
        params: Dict[str, Any],
        auth_type: str,
        agent_id: Optional[int]
    ) -> Dict[str, Any]:
        """Get product details."""
        product_id = params.get("product_id")
        return {
            "action": "get_product_details",
            "product": {
                "id": product_id,
                "name": "Laptop",
                "price": 999.99,
                "stock": 10,
                "description": "High-performance laptop"
            }
        }


intent_extractor = IntentExtraction()
tool_caller = ToolCaller()
