#!/bin/bash

# --- Secure .env and .gitignore Setup Script ---

ROOT_ENV_FILE=".env"
FRONTEND_ENV_FILE="frontend/.env"
GITIGNORE_FILE=".gitignore"
KEY_NAME="VITE_GOOGLE_MAPS_KEY"

echo "--- Secure Environment Setup Script ---"

# 1. Prompt for API key
read -p "Please enter your Google Maps API Key for $KEY_NAME: " USER_KEY_INPUT

# 2. Create root-level .env file (if missing)
if [ -f "$ROOT_ENV_FILE" ]; then
  echo "⚠️  Root-level '$ROOT_ENV_FILE' already exists. Not overwriting for security."
else
  echo "$KEY_NAME=\"$USER_KEY_INPUT\"" > "$ROOT_ENV_FILE"
  echo "✅ Created root '$ROOT_ENV_FILE' with your key."
fi

# 3. Ensure .gitignore exists and add .env entries if missing
if [ -f "$GITIGNORE_FILE" ]; then
  if ! grep -Fxq "$ROOT_ENV_FILE" "$GITIGNORE_FILE"; then
    echo -e "\n# Environment Variables\n$ROOT_ENV_FILE" >> "$GITIGNORE_FILE"
    echo "✅ Added '$ROOT_ENV_FILE' to '$GITIGNORE_FILE'."
  fi
  if ! grep -Fxq "$FRONTEND_ENV_FILE" "$GITIGNORE_FILE"; then
    echo "$FRONTEND_ENV_FILE" >> "$GITIGNORE_FILE"
    echo "✅ Added '$FRONTEND_ENV_FILE' to '$GITIGNORE_FILE'."
  fi
else
  echo -e "# Environment Variables\n$ROOT_ENV_FILE\n$FRONTEND_ENV_FILE" > "$GITIGNORE_FILE"
  echo "✅ Created '$GITIGNORE_FILE' and added .env entries."
fi

# 4. Create frontend/.env file
mkdir -p frontend
if [ -f "$FRONTEND_ENV_FILE" ]; then
  echo "⚠️  '$FRONTEND_ENV_FILE' already exists. Not overwriting for security."
else
  echo "$KEY_NAME=\"$USER_KEY_INPUT\"" > "$FRONTEND_ENV_FILE"
  echo "✅ Created '$FRONTEND_ENV_FILE' with your key."
fi

echo "--- Setup Complete ---"
echo "🚨 Security Reminder: Never commit any .env files to Git!"
echo "🔑 Your API key is stored securely in the .env files."