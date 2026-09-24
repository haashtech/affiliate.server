export const rateLimitConfig = [
  {
    route: "/api/user",
    noLimit: true, 
  },
  {
    route: "/api/user/withdrawal/new-withdrawal/",
    window: "1m",
    max: 1,
  },
  {
    route: "/api/admin/products",
    window: "3m",
    max: 30,
  },
  {
    route: "/api/admin/platform/update",
    window: "3m",
    max: 20,
  },
  {
    route: "/api/admin/platform/general/settings",
    method: "POST",
    window: "3m",
    max: 20,
  },
  {
    route: "/api/users/products",
    noLimit: true, 
  },
  {
    route: "/api/affiliate",
    noLimit: true,
  },
  {
    route: "/api/wallet",
    noLimit: true,
  },
  {
    route: "/api/web-hook",
    noLimit: true, // NEVER throttle webhook
  },
];
