# Standard Operating Procedure: Code Deployment

The command `git push origin main` is not a special command. It is our standard, repeatable command for this project's workflow.

### Analysis: The `git push` Command

The command `git push origin main` is a precise instruction with three distinct parts:

1.  **`git push`**: The core action. This instructs Git to "push" (i.e., upload and synchronize) your locally committed changes to a remote server.
2.  **`origin`**: The destination. This is the conventional name for the primary remote repository (in our case, the one hosted on GitHub). You are telling Git *where* to send the changes.
3.  **`main`**: The target branch. This specifies *which branch* on the `origin` remote you want to update with your local changes. In our workflow, `main` is the definitive source of truth for our production deployment.

Therefore, the command translates to: **"Push my committed changes to the GitHub repository, specifically updating the main branch."**

The other variations are for more complex branching strategies (e.g., pushing to feature branches for pull requests), which are not part of our current high-velocity, single-developer workflow. For our purposes, `git push origin main` is the only push command needed.

---

### Standard Operating Procedure: Code Deployment

To ensure flawless execution every time, this is our codified, four-step deployment process.

1.  **Stage Changes:**
    ```bash
    git add .
    ```

2.  **Commit Changes:**
    ```bash
    git commit -m "feat(scope): A clear description of the change"
    ```

3.  **Push to Remote:**
    ```bash
    git push origin main
    ```

4.  **Deploy to Production:**
    ```bash
    vercel --prod
    ```
