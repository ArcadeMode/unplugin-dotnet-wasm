using System;
using TypeShim;

namespace Client.Library;

[TSExport]
public class Throws
{
    public void Boom() => throw new InvalidOperationException("Boom from .NET");
}
