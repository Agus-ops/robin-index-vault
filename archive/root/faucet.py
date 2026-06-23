#!/usr/bin/env python3

import requests
import urllib3

urllib3.disable_warnings()

r = requests.post(
    "https://api.sandbox.paxos.com/v2/treasury/faucet/transfers",
    json={
        "token": "USDG",
        "network": "ROBINHOOD",
        "address": "0xD2F9f6381Fb5f00c2fC606553592dB28309c019d"
    },
    verify=False
)

print(r.status_code)
print(r.text)
