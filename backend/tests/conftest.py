import os
import sys

# Make backend/ importable so tests can `import shipping_check`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
