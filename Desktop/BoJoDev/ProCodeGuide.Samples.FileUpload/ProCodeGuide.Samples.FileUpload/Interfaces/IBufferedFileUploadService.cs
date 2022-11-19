using Microsoft.AspNetCore.WebUtilities;

namespace ProCodeGuide.Samples.FileUpload.Interfaces
{
    public interface IBufferedFileUploadService
    {
        Task<bool> UploadFile(IFormFile file);
    }
}
