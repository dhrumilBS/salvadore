# Task: WordPress Content Export Tool

## Objective

Create a WordPress admin tool that exports all published content (Posts and Pages) along with all important editable fields and SEO metadata.

The tool should allow filtering, sorting, searching, and exporting data to CSV or Excel.

---

# Content Types

Include:

- Posts
- Pages

(Optional)
- Support Custom Post Types through a filter.

---

# Include Only

```
post_status = publish
```

---

# Retrieve the Following Fields

## Basic Information

- ID
- Post Type
- Title
- Slug
- Permalink
- Status
- Author
- Author Name
- Publish Date
- Modified Date
- Post Order (menu_order)
- Parent Page
- Parent ID
- Template
- Featured Image URL
- Featured Image ID
- Comment Status
- Ping Status
- Password Protected
- Sticky Post
- GUID

---

## SEO

Retrieve from Yoast SEO (fallback if empty).

- Meta Title
- Meta Description
- Focus Keyword
- Canonical URL
- Robots Index
- Robots Follow
- Open Graph Title
- Open Graph Description
- Open Graph Image
- Twitter Title
- Twitter Description

Meta Keys

```
_wpseo_title
_wpseo_metadesc
_wpseo_focuskw
_wpseo_canonical
_wpseo_meta-robots-noindex
_wpseo_meta-robots-nofollow
_wpseo_opengraph-title
_wpseo_opengraph-description
_wpseo_opengraph-image
_wpseo_twitter-title
_wpseo_twitter-description
```

---

## Content

Export

- Post Content
- Excerpt
- Word Count
- Reading Time
- Content Length

---

## Categories

For Posts

Return

- Category IDs
- Category Names
- Category Slugs

---

## Tags

Return

- Tag IDs
- Tag Names
- Tag Slugs

---

## Page Information

If Page

Return

- Parent Page
- Page Template
- Menu Order

---

## Featured Image

Return

- Attachment ID
- Image URL
- Alt Text

---

## Custom Fields

Return ALL custom fields.

```
get_post_meta($post_id)
```

Do not exclude unknown meta keys.

---

## Taxonomies

Return all assigned taxonomies.

Dynamic.

---

## Editable Fields

Export every editable field available from the WordPress editor.

Including

- Title
- Slug
- Content
- Excerpt
- Status
- Publish Date
- Modified Date
- Menu Order
- Parent
- Template
- Featured Image
- Categories
- Tags
- Custom Fields
- SEO Fields

---

# Sorting

Default

```
Publish Date DESC
```

Allow sorting by

- Publish Date
- Modified Date
- Title
- Menu Order
- Author
- Post Type

---

# Filters

Provide filters for

- Post Type
- Author
- Status
- Category
- Tag
- Publish Date Range
- Modified Date Range

---

# Search

Search by

- Title
- Slug
- Content
- Meta Title
- Meta Description
- Focus Keyword

---

# Export

Support

- CSV
- Excel (.xlsx)
- JSON

Export should respect

- Current filters
- Current sorting
- Current search

---

# CSV Columns

Export every retrieved field.

One row per post.

---

# Excel

Create

- Auto-sized columns
- Bold header
- Freeze first row
- UTF-8
- Proper date formatting

---

# JSON

Return structured JSON.

Example

```json
{
  "id": 15,
  "post_type": "page",
  "title": "About Us",
  "slug": "about-us",
  "permalink": "https://example.com/about-us/",
  "publish_date": "2025-05-12",
  "modified_date": "2025-06-10",
  "menu_order": 0,
  "meta_title": "...",
  "meta_description": "...",
  "focus_keyword": "...",
  "categories": [],
  "tags": [],
  "featured_image": "...",
  "template": "default",
  "custom_fields": {}
}
```

---

# Performance

Must support

- 50,000+ posts

Requirements

- Pagination
- Lazy loading
- Batch processing
- Memory efficient queries

Avoid loading everything into memory.

---

# WordPress APIs

Prefer

```
WP_Query
```

Use

```
get_post_meta()

get_the_terms()

get_permalink()

get_the_post_thumbnail_url()

get_page_template_slug()

get_userdata()

get_post_field()

wp_get_post_categories()

wp_get_post_tags()
```

Avoid direct SQL unless absolutely necessary.

---

# UI

Create an Admin page.

Features

- Data Table
- Pagination
- Search
- Filters
- Sort
- Export CSV
- Export Excel
- Export JSON

---

# Code Quality

- OOP
- Secure
- Nonce validation
- Capability checks
- Prepared statements where needed
- AJAX for loading/export
- Follow WordPress Coding Standards
- Compatible with latest WordPress version

---

# Deliverables

Implement:

- Admin page
- AJAX endpoints
- Export handlers (CSV, XLSX, JSON)
- Data retrieval service
- Helper functions
- Clean reusable classes