import os
import json
import time
import requests
import random

# ==========================================
# CONFIGURATION
# ==========================================
UNSPLASH_ACCESS_KEY = "eQ6DYGJH7zUpH_rTf_mbvvtTW8J-8uikiHJTqGq3jZE"
APEXKIT_BASE_URL = "http://127.0.0.1:5000"  # Change if hosted remotely
APEXKIT_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbkBhcGV4a2l0LmlvIiwidWlkIjoxLCJyb2xlIjoiYWRtaW4iLCJleHAiOjE3ODMwNjIyMTYsInNjb3BlIjoicm9vdCJ9.4U7TxUpG4Odcpoj54PqghTsst7eZ7TxeWHqitmY1w6k"  # JWT or API Key
TENANT_ID = "vortex"
COLLECTION_NAME = "pins"


# The specific search query and pagination configuration
SEARCH_QUERY = "Woman Body"
PAGE = 5
PER_PAGE = 30
DEFAULT_CATEGORY = "women"

# File to keep track of successfully uploaded image IDs
TRACKING_FILE = "unsplash-successful-fetched-images.json"

# ==========================================
# TRACKING UTILS
# ==========================================
def load_tracked_ids():
    """Load previously fetched Unsplash IDs to avoid duplicates."""
    if os.path.exists(TRACKING_FILE):
        with open(TRACKING_FILE, 'r') as f:
            try:
                return set(json.load(f))
            except json.JSONDecodeError:
                return set()
    return set()

def save_tracked_id(photo_id):
    """Save a successfully processed ID to the tracking file."""
    tracked = load_tracked_ids()
    tracked.add(photo_id)
    with open(TRACKING_FILE, 'w') as f:
        json.dump(list(tracked), f, indent=2)

# ==========================================
# UNSPLASH API
# ==========================================
def fetch_unsplash_search(query, page=1, per_page=15):
    """Fetch photos from Unsplash based on our search query and pagination settings."""
    print(f"📸 Searching Unsplash for '{query}' (Page {page}, Per Page {per_page})...")
    
    url = "https://api.unsplash.com/search/photos"
    params = {
        "query": query,
        "page": page,
        "per_page": per_page,
        "orientation": "portrait"
    }
    headers = {
        "Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}",
        "Accept-Version": "v1"
    }

    response = requests.get(url, headers=headers, params=params)
    if response.status_code != 200:
        print(f"❌ Unsplash API Error: {response.text}")
        return []
        
    return response.json().get("results", [])

# ==========================================
# APEXKIT UPLOAD & SEED
# ==========================================
def upload_image_to_apexkit(image_url, original_filename):
    """Download image from Unsplash and upload it to ApexKit storage."""
    print("  ⬇️  Downloading image from Unsplash...")
    img_res = requests.get(image_url)
    if img_res.status_code != 200:
        print("  ❌ Failed to download image.")
        return None
        
    img_bytes = img_res.content
    
    print("  ☁️  Uploading to ApexKit...")
    upload_url = f"{APEXKIT_BASE_URL}/tenant/{TENANT_ID}/api/v1/storage/upload"
    headers = {
        "Authorization": f"Bearer {APEXKIT_TOKEN}"
    }
    files = {
        'file': (original_filename, img_bytes, 'image/jpeg')
    }
    
    response = requests.post(upload_url, headers=headers, files=files)
    if response.status_code in [200, 201]:
        return response.json().get("filename")
    else:
        print(f"  ❌ Upload failed: {response.text}")
        return None

def extract_approved_category(photo_data):
    """Finds the first approved topic key and formats it as the category."""
    topic_subs = photo_data.get('topic_submissions', {})
    
    # 1. Parse the first approved topic key directly from Unsplash
    for topic, details in topic_subs.items():
        if isinstance(details, dict) and details.get('status') == 'approved':
            # Dynamically normalize key name: "fashion-beauty" -> "Fashion Beauty"
            return topic.replace("-", " ").title()
            
    # 2. Fallback category if no approved topic exists
    return DEFAULT_CATEGORY

def create_pin_record(filename, photo_data):
    """Create a record in the ApexKit pins collection."""
    
    # Extract Title
    title = photo_data.get('alt_description') or photo_data.get('description') or "Untitled"
    title = title.title()[:50]
    
    # Extract Description
    description = photo_data.get('description') or "High fashion photography on Unsplash."
    
    # Extract Likes Count (direct mapping)
    likes_count = photo_data.get('likes') or 0
    
    # Extract Category dynamically from approved Unsplash topic keys
    category = extract_approved_category(photo_data)
    
    # Extract Tags
    tags = ["unsplash", "vortex", DEFAULT_CATEGORY]
    if 'tags' in photo_data:
        tags.extend([t.get('title') for t in photo_data['tags'] if 'title' in t])

    # Calculate approximate responsive masonry height
    orig_width = photo_data.get('width', 1000)
    orig_height = photo_data.get('height', 1500)
    aspect_ratio = orig_height / orig_width
    masonry_height = min(max(aspect_ratio * 300, 200), 500)

    # Build DB payload
    payload = {
        "data": {
            "title": title,
            "description": description,
            "category": category,
            "tags": list(set(tags))[:5],
            "image": filename,
            "height": round(masonry_height),
            "likes_count": likes_count,
            "metadata": photo_data  # Dump raw JSON response directly
        }
    }

    record_url = f"{APEXKIT_BASE_URL}/tenant/{TENANT_ID}/api/v1/collections/{COLLECTION_NAME}/records"
    headers = {
        "Authorization": f"Bearer {APEXKIT_TOKEN}",
        "Content-Type": "application/json"
    }

    response = requests.post(record_url, headers=headers, json=payload)
    if response.status_code in [200, 201]:
        print(f"  ✅ Successfully created Pin: {title} (Likes: {likes_count}, Category: {category})")
        return True
    else:
        print(f"  ❌ Failed to create record: {response.text}")
        return False

# ==========================================
# MAIN ROUTINE
# ==========================================
def main():
    print(f"🚀 Starting Unsplash seeder for tenant '{TENANT_ID}'")
    
    tracked_ids = load_tracked_ids()
    print(f"📂 Loaded {len(tracked_ids)} processed image IDs from tracker.")
    
    photos = fetch_unsplash_search(query=SEARCH_QUERY, page=PAGE, per_page=PER_PAGE)
    if not photos:
        print("No photos found.")
        return
        
    for index, photo in enumerate(photos):
        photo_id = photo['id']
        print(f"\nProcessing {index + 1}/{len(photos)}: {photo_id}")
        
        if photo_id in tracked_ids:
            print("  ⏭️  Already processed. Skipping.")
            continue
            
        image_url = photo['urls']['regular']
        original_filename = f"unsplash_{photo_id}.jpg"
        
        # 1. Upload
        saved_filename = upload_image_to_apexkit(image_url, original_filename)
        
        if saved_filename:
            # 2. Record Creation
            success = create_pin_record(saved_filename, photo)
            
            # 3. Track
            if success:
                save_tracked_id(photo_id)
            
            time.sleep(1)

if __name__ == "__main__":
    main()