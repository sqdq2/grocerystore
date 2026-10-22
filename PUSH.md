# Publishing to GitHub

This sandbox has no GitHub credentials, so the final `git push` must run from a
machine where you are signed in.

```bash
cd grocerystore
git remote -v          # should already point at https://github.com/sqdq2/grocerystore.git
git push -u origin main
```

If `origin` is missing:

```bash
git remote add origin https://github.com/sqdq2/grocerystore.git
git push -u origin main
```

You will be asked for your GitHub username and a **Personal Access Token**
(not your password):

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Permissions: **Contents → Read and write** on `sqdq2/grocerystore`
3. Copy the token, then paste it as the password when git prompts

Everything is already committed on `main` — nothing else to do.

## Run it locally first

```bash
npm start       # http://localhost:3000
npm test        # 109 end-to-end API checks
```
