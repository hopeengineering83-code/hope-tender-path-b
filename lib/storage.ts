export async function saveUploadedFile(file: File) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
  };
}
