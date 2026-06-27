# Roles

https://pad.lescommuns.org/sD5H7KynSoud-ygSd_4G2Q

## TODO

### Bootstrapping

* [x] Create RoleRegistry

### UI

* [x] Add view to Peers for Role management
* [x] Roles can be created and deleted
* [x] Peers can be added to / remove from roles
* [x] Authorize Role (using app needs)
* [ ] Authorize using Role as scope

### RPC

* [x] define RPC messages
* [ ] update messages for AllFromRole scope

### Workflows

* [x] Creating authorization for a role should update grants for all members
* [x] Adding peer to role should issue grants based on authorizations for that role
* [x] Removing peer from role should revoke grants based on authorizations for that role
* [x] Deleting role should revoke all authorizations (and grants) based on that role
* [ ] Creating authorization with role as scope should generate data grants for data of all agents in the role
* [ ] Adding peer to role should update grants for authorizations with that role as scope
* [ ] Removing peer from role should  update grants for authorizations with that role as scope
* [ ] Deleting role should revoke all authorizations (and grants) with that role as scope

### Algorithms

* [ ] Generating grants using combination of direct and role authorizations

