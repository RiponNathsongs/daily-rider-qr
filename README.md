# Daily Rider ID & QR

This is the starter project for a GitHub Pages + Firebase version.

## Main behavior

- Public users can search today's assigned IDs.
- Public users can generate a QR for any ID without assigning a rider.
- Only the admin account can add/remove riders and add/delete assigned daily IDs.
- Daily searches use Bangladesh time (`Asia/Dhaka`).
- Old days are excluded automatically from the public/admin daily view.

## First setup

1. Create a Firebase project.
2. Enable Authentication -> Email/Password.
3. Create the admin email/password account.
4. Create Firestore Database.
5. Register a Web App and copy its Firebase config into `firebase-config.js`.
6. Put the exact admin email in `ADMIN_EMAIL`.
7. Add Firestore security rules that allow public reads of current-day records but allow writes only to the admin account. Do not publish the site before applying proper rules.
8. Test locally, then upload the files to GitHub Pages.

## Important

GitHub Pages itself cannot securely protect admin writes. Firebase Authentication + Firestore Security Rules are required for the real admin protection.

The current starter hides old daily records by date. A later production step can add Firestore TTL cleanup so expired records are physically deleted as well.
