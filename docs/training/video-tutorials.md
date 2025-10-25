# Video Tutorials

Three short tutorials are recorded and stored in the training bucket `s3://community-content-hub-training/videos/`.

1. **Tour of the Dashboard** (`tutorial-01-dashboard.mp4`, 4m12s)
   - Introduces navigation, widgets, and saved searches.
2. **Publishing New Content** (`tutorial-02-content.mp4`, 3m47s)
   - Demonstrates adding content, validation, and bulk visibility updates.
3. **Reporting & Exports** (`tutorial-03-analytics.mp4`, 5m05s)
   - Shows how to export analytics CSVs, program reports, and interpret charts.

Each MP4 uses 1080p resolution with captions embedded (`.vtt` files in the same folder).

## Access instructions
- Run `aws s3 sync s3://community-content-hub-training/videos ./training-videos` (requires `TrainingAssetsDownload` IAM policy).
- Videos are embedded in the public documentation portal using CloudFront distribution `d3nq2w0l4vj1cf.cloudfront.net`.
