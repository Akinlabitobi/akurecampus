import { escapeHtml } from "../lib/format.js";
import { preparePhoto } from "../lib/photos.js";
import { state } from "../lib/state.js";
import { icon } from "./icon.js";

// The preview shows, in order: a newly picked photo, the photo already on
// file (the profile editor passes it as `existing`), or a camera icon.
function photoPickerInner(target, existing = "") {
  const shown = state.photoDrafts[target] || existing;
  return `
    <span class="photo-preview">${shown ? `<img src="${escapeHtml(shown)}" alt="Selected photo" />` : icon("camera")}</span>
    <span class="photo-copy">
      <strong>${state.photoBusy[target] ? "Preparing photo..." : shown ? "Change photo" : "Add a photo"}</strong>
      <small>A clear, recent picture of your face. JPEG or PNG.</small>
    </span>
  `;
}

export function photoPicker(target, label, existing = "") {
  return `
    <div class="photo-field">
      <span>${label}</span>
      <label class="photo-picker ${state.photoDrafts[target] || existing ? "has-photo" : ""}" data-photo-existing="${escapeHtml(existing)}">
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-photo-input="${target}" />
        <span class="photo-picker-inner">${photoPickerInner(target, existing)}</span>
      </label>
    </div>
  `;
}

export function updatePhotoPicker(form, target) {
  const picker = form.querySelector(".photo-picker");
  const existing = picker.dataset.photoExisting || "";
  picker.classList.toggle("has-photo", Boolean(state.photoDrafts[target] || existing));
  picker.querySelector(".photo-picker-inner").innerHTML = photoPickerInner(target, existing);
}

export async function choosePhoto(input) {
  const form = input.form;
  const target = input.dataset.photoInput;
  const note = form.querySelector(".form-note");
  const file = input.files?.[0];
  if (!file) return;
  state.photoBusy[target] = true;
  updatePhotoPicker(form, target);
  try {
    state.photoDrafts[target] = await preparePhoto(file);
    note.className = "form-note";
    note.textContent = "Photo added.";
  } catch (error) {
    note.className = "form-note error";
    note.textContent = error.message;
  } finally {
    state.photoBusy[target] = false;
    input.value = "";
    updatePhotoPicker(form, target);
  }
}
