# Changelog

## v1.0.1

- Fix DHCP `OFFER` and `ACK` replies on multi-homed macOS hosts by sending responses to the selected interface's subnet broadcast address instead of the global broadcast route.
- Update the DHCP safety probe to use the selected interface's subnet broadcast path.
- Exclude reserved addresses from the lease pool: server IP, router, network address, and broadcast address.
- Track pending DHCP offers so different clients do not receive the same IP before lease confirmation.
- Reject invalid startup configurations when the DHCP range or router falls outside the selected interface subnet.
- Reject DHCP ranges that contain only reserved addresses.
