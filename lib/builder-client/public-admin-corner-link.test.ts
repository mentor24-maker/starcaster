import { describe, expect, it } from "vitest";
import {
  ADMIN_LOGIN_PATH,
  ADMIN_LOGOUT_PATH,
  adminCornerLink,
} from "./public-admin-session";

/**
 * The fixed corner button on a tenant's site.
 *
 * Two failures this guards, both of which would reach the tenant rather than a
 * test: offering "Logout" beside a sign-in form, and turning the button into a
 * logout everywhere so the public site has no route into the admin area at all.
 */
describe("adminCornerLink", () => {
  it("shows nothing to an ordinary visitor", () => {
    expect(adminCornerLink("home", { isAdminNav: false })).toBeNull();
    expect(adminCornerLink("admin-dashboard", { isAdminNav: false })).toBeNull();
  });

  it("is the way IN on the public site", () => {
    for (const slug of ["home", "pickleball", "programs-junior", "blog-home"]) {
      const link = adminCornerLink(slug, { isAdminNav: true });
      expect(link, slug).toEqual({
        label: "Admin",
        href: ADMIN_LOGIN_PATH,
        ariaLabel: "Admin",
      });
    }
  });

  it("is the way OUT on every admin page", () => {
    for (const slug of [
      "admin-dashboard",
      "admin-blog-manager",
      "admin-contact-manager",
      "admin-settings",
      "admin-support",
    ]) {
      const link = adminCornerLink(slug, { isAdminNav: true });
      expect(link?.label, slug).toBe("Logout");
      expect(link?.href, slug).toBe(ADMIN_LOGOUT_PATH);
    }
  });

  it("still says Admin on the sign-in page itself", () => {
    // admin-login is deliberately a PUBLIC slug — it is the front door. A
    // "Logout" button next to a sign-in form would be nonsense, and worse, it
    // would be the only control offered to someone who cannot get in.
    expect(adminCornerLink("admin-login", { isAdminNav: true })?.label).toBe("Admin");
  });

  it("treats the private editor slugs as admin area too", () => {
    // These are private without the admin- prefix; they are only reachable with
    // a live admin session, so the same reasoning applies.
    expect(adminCornerLink("crm", { isAdminNav: true })?.label).toBe("Logout");
    expect(adminCornerLink("blog-post-edit", { isAdminNav: true })?.label).toBe("Logout");
  });
});
