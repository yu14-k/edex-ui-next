class DocReader {
    constructor(opts) {
        // pdfjs-dist 6 is ESM-only: it is bundled into a classic script by
        // `npm run vendor` (see vendor.js) because Chromium refuses to execute
        // ES *module scripts* from a file:// page. Module *workers* are allowed,
        // so the worker file is referenced directly.
        const pdfBase = './assets/vendor/pdfjs/';
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfBase + 'pdf.worker.mjs';
        const modalElementId = "modal_" + opts.modalId;
        const path = opts.path;
        const scale = 1;
        const canvas = document.getElementById(modalElementId).querySelector(".pdf_canvas");
        const context = canvas.getContext('2d');
        const loadingTask = pdfjsLib.getDocument({
            url: path,
            cMapUrl: pdfBase + 'cmaps/',
            cMapPacked: true,
            standardFontDataUrl: pdfBase + 'standard_fonts/',
            wasmUrl: pdfBase + 'wasm/'
        });
        let pdfDoc = null;
        let renderingPromise = null;
        let pageNum = 1,
            pageRendering = false,
            pageNumPending = null,
            zoom = 100; // eslint-disable-line no-unused-vars

        // Single document load shared by every page render
        renderingPromise = loadingTask.promise.then(pdf => {
            pdfDoc = pdf;
            document.getElementById(modalElementId).querySelector(".page_count").textContent = pdfDoc.numPages;
            this.renderPage(pageNum);
        });

        this.renderPage = (num) => {
            pageRendering = true;
            renderingPromise.then(() => {
                return pdfDoc.getPage(num).then(page => {
                    const viewport = page.getViewport({ scale: scale });
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                    };
                    const renderTask = page.render(renderContext);
                    return renderTask.promise.then(() => {
                        pageRendering = false;
                        if (pageNumPending !== null) {
                            this.renderPage(pageNumPending);
                            pageNumPending = null;
                        }
                    });
                });
            });
            document.getElementById(modalElementId).querySelector(".page_num").textContent = num;
        }

        this.queueRenderPage = (num) => {
            if (pageRendering) {
                pageNumPending = num;
            } else {
                this.renderPage(num);
            }
        }

        this.onPrevPage = () => {
            if (pageNum <= 1) {
                return;
            }
            pageNum--;
            this.queueRenderPage(pageNum);
        }

        this.onNextPage = () => {
            if (pageNum >= pdfDoc.numPages) {
                return;
            }
            pageNum++;
            this.queueRenderPage(pageNum);
        }

        this.zoomIn = () => {
            if (zoom >= 200) {
                return;
            }
            zoom = zoom + 10;
            canvas.style.zoom = zoom + "%";
        }

        this.zoomOut = () => {
            if (zoom <= 50) {
                return;
            }
            zoom = zoom - 10;
            canvas.style.zoom = zoom + "%";
        }

        document.getElementById(modalElementId).querySelector(".previous_page").addEventListener('click', this.onPrevPage);
        document.getElementById(modalElementId).querySelector(".next_page").addEventListener('click', this.onNextPage);
        document.getElementById(modalElementId).querySelector(".zoom_in").addEventListener('click', this.zoomIn);
        document.getElementById(modalElementId).querySelector(".zoom_out").addEventListener('click', this.zoomOut);
    }
}

module.exports = {
    DocReader
};