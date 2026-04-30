export function userCan(user, environment, permission) {
  if (!user) {
    return false;
  }
  if (user.is_super_admin) {
    return true;
  }
  if (!environment || environment === "all") {
    return false;
  }
  const permissions = user.permissions_by_environment?.[environment] || [];
  return permissions.includes("*") || permissions.includes(permission) || (permission === "read" && permissions.includes("read"));
}
