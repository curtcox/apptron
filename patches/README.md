# Upstream patches

`0001-skip-dhcp-without-network.patch` guards `/bin/init`'s DHCP setup with an
eth0 existence check. Without it, Apptron console mode with a signed-in guest
attempts DHCP even when Wanix has no configured relay. This was found during
the offline boot spike. The upstream submodule remains unchanged.

The matching Wanix loader is built from the module revision in Apptron's go.mod,
rather than patching upstream boot code to support an incompatible newer image.
No upstream PR has been submitted from this task.
