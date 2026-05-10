import sys
sys.path.insert(0, '/home/0xKaBG/Projects/athttt_2025.2')
import os
os.environ["DATABASE_URL"] = "sqlite:///./test_debug.db"
os.environ["NIM_API_KEY"] = "test"
os.environ["JWT_SECRET_KEY"] = "test"
os.environ["ZKP_SECRET_KEY"] = "test"
os.environ["ENVIRONMENT"] = "test"

from backend.auth.zkp import zkp_auth, _DHQ, verify_proof
import json

print(f"Q in verify_proof module: {hex(_DHQ)}")

password = "my_secret_password"
public_key, _ = zkp_auth.create_client_signature(password)
print(f"public_key type: {type(public_key)}")
print(f"public_key: {public_key[:80]}...")

pk_parsed = json.loads(public_key)
print(f"pk['y'] = {pk_parsed['y']}")
print(f"pk['p'] = {pk_parsed['p']}")
print(f"pk['g'] = {pk_parsed['g']}")
print(f"pk['q'] = {pk_parsed['q']}")

token, _ = zkp_auth.create_token()
print(f"token type: {type(token)}")
print(f"token: {token}")

proof, _ = zkp_auth.sign_data(password, public_key, token)
print(f"proof type: {type(proof)}")
print(f"proof: {proof}")

is_valid, elapsed = verify_proof(proof, public_key, token)
print(f"is_valid: {is_valid}, elapsed: {elapsed}")