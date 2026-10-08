// Phone cameras produce 3-12MB photos; shrinking to at most 1200px JPEG in
// the browser keeps uploads quick on mobile data and well under the server's
// size limit. Drawing through an <img> also applies the photo's EXIF
// rotation, so sideways phone pictures come out upright.
export function preparePhoto(file) {
  return new Promise((resolvePhoto, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolvePhoto(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo could not be opened. Please choose a JPEG or PNG picture."));
    };
    image.src = url;
  });
}
