# Standard Operating Procedure: Code Deployment

> Project canon: [`AI_AGENT_HANDOFF.md`](AI_AGENT_HANDOFF.md) · Env template: [`.env.example`](../.env.example)


This document establishes the definitive four-step workflow for deploying code securely and reliably. It provides clear guidelines on version control, staging, and the critical distinction between preview and production updates. 

---

### Process Analysis: Source of Truth vs. Production Release

While Vercel's Git integration automatically triggers a deployment upon a `git push`, the `git push` and `vercel --prod` commands are **not redundant**. They serve distinct and critical functions in a controlled deployment pipeline. Understanding this distinction is paramount.

1.  **`git push origin main`**: This command's sole responsibility is to **update the central code repository** (the source of truth on GitHub). This ensures that our definitive codebase is secured and versioned. 
    *   *The `git push` command is a precise instruction with three parts:*
        *   **`git push`**: The core action to synchronize local changes to a remote server.
        *   **`origin`**: The conventional name for the primary remote repository (GitHub).
        *   **`main`**: The target branch, serving as our definitive source of truth.
    *   *The automatic deployment triggered by this push is a **Preview Deployment**.* It builds the latest commit and assigns it a unique, non-production URL. This is a safety mechanism, allowing the system to verify the build succeeds before it's considered for production.

2.  **`vercel --prod`**: This command is an **explicit promotion directive**. It instructs Vercel to take the current state of your code, perform a production-optimized build, and—most importantly—**alias the resulting deployment to your production domain** (`app.isitas.org`). This is the deliberate, manual action of "going live." It is the final gate.

**In short:**
*   `git push` updates the blueprint.
*   `vercel --prod` gives the explicit order to manufacture and ship the product to the public.

---

### Why We Use Both: Control and Certainty

Our Standard Operating Procedure requires both commands, in sequence, for these strategic reasons:

*   **Safety:** We never want an accidental or broken commit to automatically become the live production site. The push-to-preview model gives us a build that can be tested before it's promoted.
*   **Control:** The `vercel --prod` command gives you, the operator, final, explicit control over the exact moment of release. This is non-negotiable for professional-grade deployments.
*   **Certainty:** Running `vercel --prod` from your local machine ensures that what you are deploying is exactly the code you have in front of you. It also provides immediate, direct feedback in your terminal, including the final production URL and the status of the deployment.

---

### Standard Operating Procedure: 4-Step Deployment

To ensure flawless execution every time and adhere to the safety standards outlined above, execute our codified four-step deployment process.

1.  **Stage Changes:**
    ```bash
    git add .
    ```

2.  **Commit Changes:**
    ```bash
    git commit -m "feat(scope): A clear description of the change"
    ```

3.  **Push to Remote (Secure the code and trigger a preview build):**
    ```bash
    git push origin main
    ```

4.  **Deploy to Production (Promote the build to the live production domain):**
    ```bash
    vercel --prod
    ```
