#!/usr/bin/env python3

import requests
from datetime import datetime

URL = "https://api.sandbox.paxos.com/v2/treasury/faucet/transfers"

WALLETS = [
    "0xD2F9f6381Fb5f00c2fC606553592dB28309c019d",
]

TOKENS = [
    "USDG",
]

for wallet in WALLETS:
    for token in TOKENS:
        try:
            r = requests.post(
                URL,
                json={
                    "token": token,
                    "network": "ROBINHOOD",
                    "address": wallet
                },
                headers={
                    "Origin": "https://faucet.paxos.com",
                    "Referer": "https://faucet.paxos.com/",
                    "Content-Type": "application/json"
                },
                timeout=30
            )

            print(
                f"[{datetime.utcnow().isoformat()}] "
                f"{token} {wallet} -> "
                f"{r.status_code} {r.text}"
            )

        except Exception as e:
            print(
                f"[{datetime.utcnow().isoformat()}] "
                f"ERROR {token} {wallet}: {e}"
            )
