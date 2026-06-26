using System.Threading.Tasks;
using TypeShim;

namespace Client.Library;

[TSExport]
public class AsyncOps
{
    public async Task<string> DelayThenEcho(string value, int delayMs)
    {
        await Task.Delay(delayMs);
        return value;
    }
}
