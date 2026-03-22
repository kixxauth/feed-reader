I have an epic (collection of user stories related to a new feature) for this website. Review these user stories and acceptance criteria, and think about how you would implement them cohesively.

<epic>
# Authentication Epic
User stories and acceptance criteria for adding authentication to the Feed Reader project.

## Story 1: Protect the site with authentication

As the website owner I want every page of the website to be protected behind user authentication.

### Acceptance Criteria

- All HTTP requests must require authentication regardless of user agent or request type
- An exception can be made for login and logout pages which should be accessed without authentication

## Story 2: Provide a simple authentication flow for users

As a user of the website I understand that I must be authenticated to gain access to any page, but I expect the login process to inject as little friction as possible to my workflow.

### Acceptance Criteria

- When a user who does not have valid proof of authentication lands on any page of the website they must be seemlessly redirected to a login page
- After authenticating with valid credentials the user must be seemlessly redirected back to the original page they attempted to access.

## Story 3: Use a GitHub as an OAuth privider

As the website owner I have chosen GitHub OAuth as the only accepted authentication flow for this website.

### Acceptance Criteria

- Authentication must be accomplished using the GitHub OAuth 2.0 web application flow documented here: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow
- The OAuth flow must implement a state parameter to prevent Cross-Site Request Forgery (CSRF).

## Story 4: Only provide authentication to allowed email addresses

As the website owner I want to provide an allow list of user email addresses which have permmission to access the site.

### Acceptance Criteria

- An allow list of email addresses must be stored on the website and must not expose read or write access to any user.
- When a user authenticates using OAuth, the website must also get all known email addresses for the user from the OAuth provider.
- If none of the known email addresses discovered from the OAuth provider match any of the email addresses in the allow list, the user must be forbidden access to the website and must not be granted authentication.
- When a user is denied access they must get an "access denied" message, but no further explanation. We don't want to leak authentication implementation details

## Story 5: Authentication session duration

As the website owner I want user authentication sessions to be restricted to a configurable time-to-live before expiring. But I also want sessions to refresh if the user accesses the website before their current session expires.

### Acceptance Criteria

- Authentication must persist across requests using an authentication session
- Sessions should expire after a period of inactivity (time-to-live / TTL)
- The website owner should be able to configure the global authentication session time-to-live.
- Authentication sessions should refresh if the user accesses the site before the session has expired.
- Expired authentication sessions should be ignored and access to the website should be denied, triggering the authentication flow

## Story 6: Logout

As a user I want to be able to logout of the website in my current web browser. When I logout I should be redirected to a logged-out page which gives me the option to log back in and redirect to the home page.

### Acceptance Criteria

- Every page on the website must provide logout access
- When a user activates the logout flow any associated authentication sessions must be cleared
- After authentication sessions are cleared the user should be redirected to a logged-out page.
- The logged out page should provide a way to log back in and redirect to the home page.
</epic>

After reviewing the user stories and acceptance criteria in this epic, create an implementation plan document. The implementation plan should be formatted as a TODO list, with each item on the list having all the information needed for an agent to complete the item.

Put your plan document in the plans/ directory when you've completed it.
