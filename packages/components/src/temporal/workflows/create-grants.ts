// Combined workflow module for the `create-grants` task queue — grants +
// org-admin workflows (createAdminGrants/revokeAdminGrants/syncAdminAcr).
// The worker bundles a single module and registers one activities set
// ({ ...grantsActivities, ...adminActivities }), so no workflow scheduled on
// this queue is left unclaimed.
export * from './grants.js'
export * from './admin.js'