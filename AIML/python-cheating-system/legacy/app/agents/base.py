import logging
from typing import Dict, Any

class BaseAgent:
    """
    Base class for AI Agents in the proctoring system.
    """
    def __init__(self, name: str):
        self.name = name
        self.logger = logging.getLogger(f"Agent-{name}")
        self.memory = {}

    async def run(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute the agent's logic.
        """
        raise NotImplementedError("Each agent must implement the run method")

    def update_memory(self, key: str, value: Any):
        self.memory[key] = value

    def get_memory(self, key: str, default: Any = None) -> Any:
        return self.memory.get(key, default)
