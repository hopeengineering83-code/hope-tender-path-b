import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  React,
  renderWithRouter,
  fireEvent,
  cleanup,
  act,
} from "./helpers/rtl-env";
import { SecureUploadPolicyEnforcer } from "../components/secure-upload-policy-enforcer";

const h = React.createElement;

// FINDING-JULES-LOW-008: Comprehensive unit test suite for secure upload policy, error-clearing,
// mixed-selection blocking, realistic FileList structures, and event propagation.
// Closes #1145.

/**
 * Creates a browser-realistic FileList mock object with proper indexed properties,
 * length property, item(index) method, and ES6 Symbol.iterator support.
 */
function createMockFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      for (const file of files) {
        yield file;
      }
    }
  } as unknown as FileList & { [key: number]: File };

  files.forEach((file, index) => {
    Object.defineProperty(fileList, index, {
      value: file,
      writable: false,
      configurable: true,
      enumerable: true,
    });
  });

  return fileList;
}

describe("SecureUploadPolicyEnforcer and Error Clearing (JULES-LOW-008)", () => {
  let fileInput: HTMLInputElement;

  beforeEach(() => {
    // Set up a mock file input matching the secure document picker contract
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.setAttribute("accept", ".pdf,.doc,.docx,.xls,.xlsx,.ods,.ppt,.pptx,.rtf,.jpg,.jpeg,.png,.gif,.webp");
    document.body.appendChild(fileInput);
  });

  afterEach(() => {
    cleanup();
    if (fileInput && fileInput.parentNode) {
      fileInput.parentNode.removeChild(fileInput);
    }
  });

  it("should implement the complete iterable FileList contract including Symbol.iterator", () => {
    const file1 = new File(["1"], "a.pdf", { type: "application/pdf" });
    const file2 = new File(["2"], "b.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    
    const fileList = createMockFileList([file1, file2]);

    // 1. Length property
    assert.equal(fileList.length, 2, "FileList must have correct length");

    // 2. Indexed access
    assert.equal(fileList[0], file1, "FileList must support index 0 access");
    assert.equal(fileList[1], file2, "FileList must support index 1 access");

    // 3. Item method
    assert.equal(fileList.item(0), file1, "FileList item(0) must return file1");
    assert.equal(fileList.item(1), file2, "FileList item(1) must return file2");
    assert.equal(fileList.item(2), null, "FileList item(out of bounds) must return null");

    // 4. Symbol.iterator compliance
    const iterated: File[] = [];
    for (const file of fileList) {
      iterated.push(file);
    }
    assert.deepEqual(iterated, [file1, file2], "FileList must be fully iterable using for...of");
  });

  it("should enforce safe extensions and reject invalid file selection, then clear alert upon subsequent valid selection and reach downstream", async () => {
    const { container } = renderWithRouter(h(SecureUploadPolicyEnforcer));

    // Register a downstream change spy
    let changeSpied = 0;
    const changeSpy = () => {
      changeSpied += 1;
    };
    fileInput.addEventListener("change", changeSpy);

    // After mounting, the observer or initial call should normalize our input
    assert.equal(fileInput.dataset.secureDocumentPicker, "true");
    assert.equal(fileInput.getAttribute("accept"), ".pdf,.docx,.xlsx,.csv,.txt");

    // 1. Simulate selecting an invalid file (.doc)
    const invalidFile = new File(["dummy content"], "proposal.doc", { type: "application/msword" });
    const invalidFileList = createMockFileList([invalidFile]);
    Object.defineProperty(fileInput, "files", {
      value: invalidFileList,
      writable: true,
      configurable: true,
    });

    const invalidEvent = new CustomEvent("change", { bubbles: true, cancelable: true });
    
    act(() => {
      fileInput.dispatchEvent(invalidEvent);
    });

    // Verify event is blocked (preventDefault) and input is cleared
    assert.equal(invalidEvent.defaultPrevented, true, "Invalid selection event must be prevented");
    assert.equal(fileInput.value, "", "Invalid input value must be cleared");
    assert.equal(changeSpied, 0, "Downstream listener must NOT be called for invalid file selection");

    // Verify error is set (accessible alert element appears)
    let alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Error alert should be rendered");
    assert.match(alertDiv.textContent || "", /unsupported format/);
    assert.match(alertDiv.textContent || "", /proposal.doc/);

    // 2. Simulate subsequent valid file selection (.pdf)
    const validFile = new File(["dummy content"], "proposal.pdf", { type: "application/pdf" });
    const validFileList = createMockFileList([validFile]);
    Object.defineProperty(fileInput, "files", {
      value: validFileList,
      writable: true,
      configurable: true,
    });

    const validEvent = new CustomEvent("change", { bubbles: true, cancelable: true });
    
    act(() => {
      fileInput.dispatchEvent(validEvent);
    });

    // Verify that the valid selection event propagates normally (not prevented) and triggers downstream handler exactly once
    assert.equal(validEvent.defaultPrevented, false, "Valid selection event must not be prevented");
    assert.equal(changeSpied, 1, "Downstream listener must be called exactly once for valid file selection");

    // Verify alert has cleared
    alertDiv = container.querySelector('[role="alert"]');
    assert.equal(alertDiv, null, "Stale error alert should be cleared after valid file selection");
  });

  it("should clear any stale error alert on valid drop event and reach downstream", async () => {
    const { container } = renderWithRouter(h(SecureUploadPolicyEnforcer));

    // Register a downstream drop spy
    let dropSpied = 0;
    const dropSpy = () => {
      dropSpied += 1;
    };
    fileInput.addEventListener("drop", dropSpy);

    // 1. Trigger an initial invalid selection to display the error
    const invalidFile = new File(["dummy content"], "photo.jpeg", { type: "image/jpeg" });
    const invalidFileList = createMockFileList([invalidFile]);
    Object.defineProperty(fileInput, "files", {
      value: invalidFileList,
      writable: true,
      configurable: true,
    });
    
    act(() => {
      fireEvent.change(fileInput);
    });

    // Confirm alert is present
    let alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Error alert should be rendered");

    // 2. Simulate a valid file drop (.docx) on the document/picker target
    const validDropFile = new File(["dummy content"], "tender.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const validFileList = createMockFileList([validDropFile]);

    // Create a browser-realistic mock DataTransfer with files
    const mockDataTransfer = {
      files: validFileList,
    };

    const dropEvent = new CustomEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: mockDataTransfer,
      writable: true,
      configurable: true,
    });

    act(() => {
      fileInput.dispatchEvent(dropEvent);
    });

    // Verify that the valid drop event is not prevented and triggers downstream handler exactly once
    assert.equal(dropEvent.defaultPrevented, false, "Valid drop event must not be prevented");
    assert.equal(dropSpied, 1, "Downstream listener must be called exactly once for valid file drop");

    // Verify that the valid drop event cleared the stale alert
    alertDiv = container.querySelector('[role="alert"]');
    assert.equal(alertDiv, null, "Stale error alert should be cleared after a valid drop event");
  });

  it("should dismiss the error alert manually when the accessible dismiss button is clicked", async () => {
    const { container } = renderWithRouter(h(SecureUploadPolicyEnforcer));

    // Trigger error alert
    const invalidFile = new File(["dummy content"], "slides.ppt", { type: "application/vnd.ms-powerpoint" });
    const invalidFileList = createMockFileList([invalidFile]);
    Object.defineProperty(fileInput, "files", {
      value: invalidFileList,
      writable: true,
      configurable: true,
    });
    
    act(() => {
      fireEvent.change(fileInput);
    });

    let alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Error alert should be rendered");

    // Find and click the dismiss button
    const dismissBtn = container.querySelector('button[aria-label="Dismiss upload error"]');
    assert.ok(dismissBtn, "Dismiss button with accessible aria-label must exist");

    act(() => {
      fireEvent.click(dismissBtn!);
    });

    // Verify alert is cleared
    alertDiv = container.querySelector('[role="alert"]');
    assert.equal(alertDiv, null, "Alert should be dismissed manually");
  });

  it("should preserve blocking, retain alert, and stop propagation on mixed selection containing both valid and invalid files", async () => {
    const { container } = renderWithRouter(h(SecureUploadPolicyEnforcer));

    // Register a downstream change spy
    let changeSpied = 0;
    const changeSpy = () => {
      changeSpied += 1;
    };
    fileInput.addEventListener("change", changeSpy);

    // Trigger an initial error alert
    const firstInvalidFile = new File(["dummy"], "bad1.rtf", { type: "application/rtf" });
    const firstFileList = createMockFileList([firstInvalidFile]);
    Object.defineProperty(fileInput, "files", {
      value: firstFileList,
      writable: true,
      configurable: true,
    });
    
    act(() => {
      fireEvent.change(fileInput);
    });

    let alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Initial error alert should be rendered");

    // Simulate mixed selection: 1 valid (.pdf) + 1 invalid (.png)
    const validFile = new File(["dummy"], "good.pdf", { type: "application/pdf" });
    const invalidFile = new File(["dummy"], "bad.png", { type: "image/png" });
    const mixedFileList = createMockFileList([validFile, invalidFile]);

    Object.defineProperty(fileInput, "files", {
      value: mixedFileList,
      writable: true,
      configurable: true,
    });

    const mixedEvent = new CustomEvent("change", { bubbles: true, cancelable: true });
    
    act(() => {
      fileInput.dispatchEvent(mixedEvent);
    });

    // Verify mixed selection is blocked and does NOT propagate to downstream handlers
    assert.equal(mixedEvent.defaultPrevented, true, "Mixed selection event must be prevented");
    assert.equal(fileInput.value, "", "Input value must be cleared on mixed selection");
    assert.equal(changeSpied, 0, "Downstream listener must NOT be called for mixed selection");

    // Verify alert remains visible and is updated with the mixed error message
    alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Error alert must remain visible for mixed selection");
    assert.match(alertDiv.textContent || "", /bad.png/);
    assert.doesNotMatch(alertDiv.textContent || "", /good.pdf/, "Valid files should not be listed as unsupported");
  });

  it("should preserve blocking, retain alert, and stop propagation on mixed drop containing both valid and invalid files", async () => {
    const { container } = renderWithRouter(h(SecureUploadPolicyEnforcer));

    // Register a downstream drop spy
    let dropSpied = 0;
    const dropSpy = () => {
      dropSpied += 1;
    };
    fileInput.addEventListener("drop", dropSpy);

    // Trigger an initial error alert
    const firstInvalidFile = new File(["dummy"], "bad1.rtf", { type: "application/rtf" });
    const firstFileList = createMockFileList([firstInvalidFile]);
    Object.defineProperty(fileInput, "files", {
      value: firstFileList,
      writable: true,
      configurable: true,
    });
    
    act(() => {
      fireEvent.change(fileInput);
    });

    let alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Initial error alert should be rendered");

    // Simulate mixed drop: 1 valid (.docx) + 1 invalid (.jpg)
    const validFile = new File(["dummy"], "good.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const invalidFile = new File(["dummy"], "bad.jpg", { type: "image/jpeg" });
    const mixedFileList = createMockFileList([validFile, invalidFile]);

    const mockDataTransfer = {
      files: mixedFileList,
    };

    const mixedDropEvent = new CustomEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(mixedDropEvent, "dataTransfer", {
      value: mockDataTransfer,
      writable: true,
      configurable: true,
    });

    act(() => {
      fileInput.dispatchEvent(mixedDropEvent);
    });

    // Verify mixed drop is blocked and does NOT propagate to downstream handlers
    assert.equal(mixedDropEvent.defaultPrevented, true, "Mixed drop event must be prevented");
    assert.equal(dropSpied, 0, "Downstream drop listener must NOT be called for mixed drop");

    // Verify alert remains visible and is updated with the mixed error message
    alertDiv = container.querySelector('[role="alert"]');
    assert.ok(alertDiv, "Error alert must remain visible for mixed drop");
    assert.match(alertDiv.textContent || "", /bad.jpg/);
    assert.doesNotMatch(alertDiv.textContent || "", /good.docx/, "Valid files should not be listed as unsupported");
  });
});
