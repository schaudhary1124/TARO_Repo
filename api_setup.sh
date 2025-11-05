#!/bin/bash

# --- Secure .env and .gitignore Setup Script ---

ENV_FILE=".env"
GITIGNORE_FILE=".gitignore"
KEY_NAME="VITE_GOOGLE_MAPS_KEY"

echo "--- Secure Environment Setup Script ---"

# 1. Get input from user
read -p "Please enter your Google Maps API Key for $KEY_NAME: " USER_KEY_INPUT

# 2. Create .env file if it doesn’t exist
if [ -f "$ENV_FILE" ]; then
  echo "⚠️  File '$ENV_FILE' already exists. Not overwriting for security."
else
  echo "$KEY_NAME=\"$USER_KEY_INPUT\"" > "$ENV_FILE"
  echo "✅ Created '$ENV_FILE' with your key."
fi

# 3. Add .env to .gitignore if missing
if [ -f "$GITIGNORE_FILE" ]; then
  if ! grep -Fxq "$ENV_FILE" "$GITIGNORE_FILE"; then
    echo -e "\n# Environment Variables\n$ENV_FILE" >> "$GITIGNORE_FILE"
    echo "✅ Added '$ENV_FILE' to '$GITIGNORE_FILE'."
  else
    echo "✔️  '$ENV_FILE' already in '$GITIGNORE_FILE'."
  fi
else
  echo "ℹ️  '$GITIGNORE_FILE' not found. Please create one and add '$ENV_FILE' manually."
fi

echo "--- Setup Complete ---"
echo "🚨 Security Reminder: Never commit your .env file to Git!"
