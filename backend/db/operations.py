from sqlalchemy.orm import Session
from typing import List, Optional
from .models import User, Agent, Product, Transaction, get_db
import bcrypt
import time


class DatabaseOperations:
    """Database operations for the Agentic Commerce platform."""

    def __init__(self):
        pass

    def create_user(self, db: Session, username: str, email: str, password: str) -> User:
        """Create a new user."""
        hashed_password = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = User(
            username=username,
            email=email,
            credentials_hash=hashed_password
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def create_agent(
        self,
        db: Session,
        user_id: int,
        name: str,
        auth_type: str,
        public_key: Optional[str] = None,
        credentials_hash: Optional[str] = None
    ) -> Agent:
        """Create a new AI Agent for a user.

        - ZKP agents: credentials_hash is NULL. Only public_key (ZKSignature params)
          is stored. The secret password is never on the server.
        - OAuth2 agents: credentials_hash stores the bcrypt-hashed client secret.
          The server never stores the raw secret.
        """
        if auth_type == "zkp":
            # ZKP: Password NEVER touches the server.
            # Only the public key (signature params) is stored.
            agent_credentials_hash = None
        elif auth_type == "oauth2":
            # OAuth2 PKJWT: client generates its own RSA keypair and sends only
            # the PUBLIC KEY to the registration endpoint. Server never has the private key.
            agent_credentials_hash = credentials_hash  # None for PKJWT variant
            agent = Agent(
                user_id=user_id,
                name=name,
                auth_type=auth_type,
                credentials_hash=agent_credentials_hash,
                public_key=None,          # client will register via POST /api/auth/oauth2/register
                oauth2_private_key=None,  # DEPRECATED: server never stores per-agent private key
            )
            db.add(agent)
            db.commit()
            db.refresh(agent)
            return agent
        else:
            raise ValueError(f"create_agent: unknown auth_type '{auth_type}'. Use 'zkp' or 'oauth2'.")

        agent = Agent(
            user_id=user_id,
            name=name,
            auth_type=auth_type,
            credentials_hash=agent_credentials_hash,
            public_key=public_key if auth_type in ("zkp", "oauth2") else None
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        return agent

    def upsert_agent(
        self,
        db: Session,
        user_id: int,
        name: str,
        auth_type: str,
        public_key: Optional[str] = None,
        credentials_hash: Optional[str] = None
    ) -> Agent:
        """Create or update an agent. Re-seeding updates existing agent's public_key."""
        existing = db.query(Agent).filter(
            Agent.user_id == user_id,
            Agent.name == name,
            Agent.auth_type == auth_type
        ).first()
        if existing:
            if public_key is not None:
                existing.public_key = public_key
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing
        return self.create_agent(db=db, user_id=user_id, name=name, auth_type=auth_type,
                                 public_key=public_key, credentials_hash=credentials_hash)

    def create_product(
        self,
        db: Session,
        name: str,
        price: float,
        stock: int,
        description: Optional[str] = None,
        category: Optional[str] = None
    ) -> Product:
        """Create a new product."""
        product = Product(
            name=name,
            price=price,
            stock=stock,
            description=description,
            category=category
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return product

    def search_products(
        self,
        db: Session,
        query: str,
        max_price: Optional[float] = None,
        category: Optional[str] = None
    ) -> List[Product]:
        """Search for products matching criteria."""
        products = db.query(Product).filter(Product.name.contains(query))

        if max_price:
            products = products.filter(Product.price <= max_price)
        if category:
            products = products.filter(Product.category == category)

        return products.all()

    def get_product(self, db: Session, product_id: int) -> Optional[Product]:
        """Get a product by ID."""
        return db.query(Product).filter(Product.id == product_id).first()

    def compare_prices(
        self,
        db: Session,
        product_ids: List[int]
    ) -> List[Product]:
        """Compare prices of multiple products."""
        products = db.query(Product).filter(Product.id.in_(product_ids)).all()
        return products

    def execute_purchase(
        self,
        db: Session,
        agent_id: int,
        product_id: int,
        quantity: int,
        auth_type: str
    ) -> Transaction:
        """Execute a purchase transaction."""
        product = self.get_product(db, product_id)

        if not product:
            raise ValueError(f"Product {product_id} not found")

        if product.stock < quantity:
            raise ValueError(f"Insufficient stock for product {product_id}")

        total_price = product.price * quantity

        # Create transaction
        transaction = Transaction(
            agent_id=agent_id,
            product_id=product_id,
            amount=quantity,
            total_price=total_price,
            auth_type_used=auth_type,
            status="completed"
        )
        db.add(transaction)

        # Update stock
        product.stock -= quantity

        db.commit()
        db.refresh(transaction)
        return transaction

    def get_agent_transactions(
        self,
        db: Session,
        agent_id: int,
        limit: int = 10
    ) -> List[Transaction]:
        """Get recent transactions for an agent."""
        transactions = db.query(Transaction)\
            .filter(Transaction.agent_id == agent_id)\
            .order_by(Transaction.created_at.desc())\
            .limit(limit)\
            .all()
        return transactions


db_ops = DatabaseOperations()
