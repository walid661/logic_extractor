#!/bin/bash
#
# Deploy fast PDF parsing service to Cloud Run (GCP)
#
# Usage:
#   ./scripts/deploy-parse-service.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - GCP project with Cloud Run API enabled
#   - Billing enabled on project
#
# Environment:
#   GCP_PROJECT_ID: Your GCP project ID
#   GCP_REGION: Deployment region (default: us-central1)
#   PARSE_SERVICE_TOKEN: Secret token for authentication

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="parse-pdf-fast"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Check prerequisites
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check project ID
if [ "$PROJECT_ID" = "your-project-id" ]; then
    echo "Error: Set GCP_PROJECT_ID environment variable"
    echo "  export GCP_PROJECT_ID=your-actual-project-id"
    exit 1
fi

# Check token
if [ -z "$PARSE_SERVICE_TOKEN" ]; then
    echo "Warning: PARSE_SERVICE_TOKEN not set. Service will run without auth."
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "=========================================="
echo "  Deploying PDF Parse Service"
echo "=========================================="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Service:  $SERVICE_NAME"
echo "Image:    $IMAGE_NAME"
echo ""

# Set project
gcloud config set project "$PROJECT_ID"

# Build image
echo "📦 Building Docker image..."
cd services/parse-pdf-fast
gcloud builds submit --tag "$IMAGE_NAME"
cd ../..

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
if [ -n "$PARSE_SERVICE_TOKEN" ]; then
    gcloud run deploy "$SERVICE_NAME" \
        --image "$IMAGE_NAME" \
        --platform managed \
        --region "$REGION" \
        --allow-unauthenticated \
        --set-env-vars "PARSE_SERVICE_TOKEN=$PARSE_SERVICE_TOKEN" \
        --max-instances 10 \
        --memory 512Mi \
        --cpu 1 \
        --timeout 30s \
        --concurrency 80
else
    gcloud run deploy "$SERVICE_NAME" \
        --image "$IMAGE_NAME" \
        --platform managed \
        --region "$REGION" \
        --allow-unauthenticated \
        --max-instances 10 \
        --memory 512Mi \
        --cpu 1 \
        --timeout 30s \
        --concurrency 80
fi

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --platform managed \
    --region "$REGION" \
    --format 'value(status.url)')

echo ""
echo "=========================================="
echo "  ✅ Deployment Complete"
echo "=========================================="
echo "Service URL: $SERVICE_URL"
echo ""
echo "Next steps:"
echo "1. Test the service:"
echo "   curl $SERVICE_URL/health"
echo ""
echo "2. Configure Supabase secrets:"
echo "   supabase secrets set PARSE_SERVICE_URL='$SERVICE_URL'"
if [ -n "$PARSE_SERVICE_TOKEN" ]; then
echo "   supabase secrets set PARSE_SERVICE_TOKEN='$PARSE_SERVICE_TOKEN'"
fi
echo ""
echo "3. Redeploy Edge Functions:"
echo "   supabase functions deploy upload-documents"
echo ""
