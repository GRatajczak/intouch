export interface ConsentBannerProps {
  /**
   * Whether a user is signed in. A signed-in user's choice is also posted to
   * /api/settings/analytics so it lands on their profile; an anonymous
   * visitor's lives in localStorage only until they have an account.
   */
  signedIn: boolean;
}
