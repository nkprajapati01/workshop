from scapy.all import sniff
from scapy.layers.inet import IP, TCP, UDP
from scapy.layers.l2 import ARP
from datetime import datetime
import json

packet_data = []

def process_packet(packet):

    packet_info = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "protocol": None,
        "transport": None,
        "src": None,
        "dst": None,
        "port": None,
        "arp_type": None
    }

    if packet.haslayer(ARP):
        packet_info["protocol"] = "ARP"
        packet_info["src"] = packet[ARP].psrc
        packet_info["dst"] = packet[ARP].pdst

        if packet[ARP].op == 1:
            packet_info["arp_type"] = "request"
        elif packet[ARP].op == 2:
            packet_info["arp_type"] = "reply"

    elif packet.haslayer(IP):
        packet_info["protocol"] = "IP"
        packet_info["src"] = packet[IP].src
        packet_info["dst"] = packet[IP].dst

        if packet.haslayer(TCP):
            packet_info["transport"] = "TCP"
            packet_info["port"] = packet[TCP].dport

        elif packet.haslayer(UDP):
            packet_info["transport"] = "UDP"
            packet_info["port"] = packet[UDP].dport

    if packet_info["protocol"]:
        packet_data.append(packet_info)

print("[*] Starting packet capture... Press Ctrl+C to stop.")

try:
    sniff(prn=process_packet, store=False)
except KeyboardInterrupt:
    pass

print(f"[*] Captured {len(packet_data)} packets. Saving to network_capture.json...")

with open("network_capture.json", "w") as f:
    json.dump(packet_data, f, indent=4)

print("[+] Done! Upload network_capture.json to the IDS Dashboard.")
