"""
Fast PDF parsing service using PyMuPDF (fitz)

Provides a simple HTTP API to extract text from PDFs, 5× faster than pdf-parse.

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8080

Endpoint:
    POST /parse
    - Multipart file upload OR application/octet-stream body
    - Returns JSON: {"pages": [{"page": 1, "text": "..."}], "total_pages": N}

Auth:
    Bearer token via Authorization header (env: PARSE_SERVICE_TOKEN)
"""

import os
import time
import logging
from typing import List, Dict
from io import BytesIO

import fitz  # PyMuPDF
import pdfplumber
from fastapi import FastAPI, File, UploadFile, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","time":"%(asctime)s","message":"%(message)s"}',
)
logger = logging.getLogger(__name__)

app = FastAPI(title="PDF Parse Service", version="1.0.0")

# Auth token from env
AUTH_TOKEN = os.getenv("PARSE_SERVICE_TOKEN", "")
if not AUTH_TOKEN:
    logger.warning("PARSE_SERVICE_TOKEN not set - authentication disabled")


class PageResult(BaseModel):
    page: int
    text: str


class ParseResponse(BaseModel):
    pages: List[PageResult]
    total_pages: int
    parse_duration_ms: int


def verify_auth(authorization: str = Header(None)):
    """Verify bearer token if AUTH_TOKEN is set"""
    if not AUTH_TOKEN:
        return  # Auth disabled

    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization format")

    token = authorization.replace("Bearer ", "")
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")


def parse_pdf_bytes(pdf_bytes: bytes) -> ParseResponse:
    """Parse PDF bytes using PyMuPDF for text and pdfplumber for tables"""
    start_time = time.time()

    try:
        # Open PDF from bytes with PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        # Open PDF from bytes with pdfplumber for tables
        pdf_plumber = None
        try:
            pdf_plumber = pdfplumber.open(BytesIO(pdf_bytes))
        except Exception as e:
            logger.warning(f"Failed to initialize pdfplumber: {e}")

        pages = []
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)

            # Extract text preserving reading order (PyMuPDF)
            blocks = page.get_text("dict")["blocks"]
            text_parts = []

            for block in blocks:
                if block["type"] == 0:  # Text block
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text_parts.append(span["text"])

            page_text = " ".join(text_parts)
            
            # Extract tables (pdfplumber)
            if pdf_plumber and page_num < len(pdf_plumber.pages):
                try:
                    plumber_page = pdf_plumber.pages[page_num]
                    tables = plumber_page.extract_tables()
                    
                    if tables:
                        page_text += "\n\n=== EXTRACTED TABLES ===\n"
                        for table in tables:
                            # Filter out empty tables
                            if not table: continue
                            
                            # Convert to simple markdown table
                            for row in table:
                                # Handle None and newlines in cells
                                clean_row = [
                                    str(cell).replace("\n", " ") if cell is not None else "" 
                                    for cell in row
                                ]
                                page_text += "| " + " | ".join(clean_row) + " |\n"
                            page_text += "\n"
                except Exception as e:
                    logger.warning(f"Table extraction failed for page {page_num + 1}: {e}")

            pages.append(PageResult(page=page_num + 1, text=page_text))

        doc.close()
        if pdf_plumber:
            pdf_plumber.close()

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(
            f'{{"event":"parse_success","pages":{len(pages)},"duration_ms":{duration_ms}}}'
        )

        return ParseResponse(
            pages=pages,
            total_pages=len(pages),
            parse_duration_ms=duration_ms,
        )

    except Exception as e:
        logger.error(
            f'{{"event":"parse_error","error":"{str(e)}","error_type":"{type(e).__name__}"}}'
        )
        raise HTTPException(status_code=500, detail=f"PDF parsing failed: {str(e)}")


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"service": "pdf-parse-fast", "status": "healthy", "engine": "PyMuPDF"}


@app.post("/parse", response_model=ParseResponse)
async def parse_pdf(
    request: Request,
    file: UploadFile = File(None),
    authorization: str = Header(None),
):
    """
    Parse PDF file and extract text by page

    Accepts:
    - Multipart file upload (form field: file)
    - application/octet-stream body

    Returns:
    - JSON with pages array and metadata
    """
    # Verify auth
    verify_auth(authorization)

    # Get PDF bytes
    if file:
        # Multipart upload
        pdf_bytes = await file.read()
        logger.info(f'{{"event":"parse_started","filename":"{file.filename}","size":{len(pdf_bytes)}}}')
    else:
        # Raw body
        pdf_bytes = await request.body()
        logger.info(f'{{"event":"parse_started","source":"raw_body","size":{len(pdf_bytes)}}}')

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="No PDF data provided")

    # Parse PDF
    result = parse_pdf_bytes(pdf_bytes)
    return result


@app.get("/health")
async def health():
    """Kubernetes/Docker health check"""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
