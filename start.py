import uvicorn
from main import app # Assuming the FastAPI app object is named 'app' in main.py

# This script launches the server cleanly without the often-buggy --reload flag 
# or file-watching overhead that caused the hang.
if __name__ == "__main__":
    print("Starting TARO Backend (non-reloading) on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
