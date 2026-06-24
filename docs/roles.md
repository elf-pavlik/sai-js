# Roles

https://pad.lescommuns.org/sD5H7KynSoud-ygSd_4G2Q

## TODO

### UI

* [x] Add view to Peers for Role management
* [x] Roles can be created and deleted
* [x] Peers can be added to / remove from roles
* [x] Authorize Role

### RPC

* [x] define RPC messages

### Algorithms

* [ ] Generating grants using combination of direct and role authorizations

### Workflows

* [x] Creating authorization for a role should update grants for all members
* [x] Adding peer to role should issue grants based on authorizations for that role
* [x] Removing peer from role should revoke grants based on authorizations for that role
* [x] Deleting role should revoke all authorizations (and grants) based on that role

### Bootstrapping

* [x] Create RoleRegistry
