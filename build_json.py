import json

with open("contracts/StockRouter_flattened.sol", "r") as f:
    source = f.read()

input_json = {
    "language": "Solidity",
    "sources": {
        "StockRouter.sol": {
            "content": source
        }
    },
    "settings": {
        "optimizer": {
            "enabled": True,
            "runs": 200
        },
        "viaIR": True,
        "evmVersion": "paris",
        "outputSelection": {
            "*": {
                "*": ["abi", "evm.bytecode"]
            }
        }
    }
}

with open("StockRouter_standard_input.json", "w") as f:
    json.dump(input_json, f, indent=2)

print("✅ JSON selesai dibuat")
